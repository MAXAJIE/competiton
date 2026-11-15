import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CircleDollarSign,
  Clock3,
  CreditCard,
  Landmark,
  Plus,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { Page, Headline } from "@/components/Reveal";
import { SkeletonBlock } from "@/components/Skeleton";
import { OverviewSkeleton } from "@/components/skeletons/OverviewSkeleton";
import { useSlowPending } from "@/lib/use-slow-pending";
import { CountUp } from "@/components/CountUp";
import { InteractiveCard } from "@/components/InteractiveCard";
import { MovingWave } from "@/components/MovingWave";
import { CashMovementChart } from "@/components/CashMovementChart";
import { useStore } from "@/lib/store";
import {
  getArApSummary,
  getCashBalance,
  getMonthly,
  getMonthlySeries,
  getRunwayMonths,
  predictNextMonthRevenue,
  usd,
} from "@/lib/calc";
import { fetchMarketSnapshot, fetchForecast, type ForecastResult } from "@/lib/api";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Overview — Cashflow" },
      {
        name: "description",
        content: "A clear view of your cash position, runway and receivables.",
      },
    ],
  }),
  component: Dashboard,
});

type MarketSnapshot = Awaited<ReturnType<typeof fetchMarketSnapshot>>;

// Months drawn by the cash-movement panel. Older rows still count everywhere else.
const MONTH_WINDOW = 12;

function Dashboard() {
  const { tx, risk, mode, loaded } = useStore();
  const [market, setMarket] = useState<MarketSnapshot | undefined>();
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let active = true;
    fetchMarketSnapshot().then((snapshot) => {
      if (active) setMarket(snapshot);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduceMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const monthly = useMemo(() => getMonthlySeries(tx, MONTH_WINDOW), [tx]);
  const monthCount = useMemo(() => getMonthly(tx).length, [tx]);
  const cash = getCashBalance(tx);
  const runway = getRunwayMonths(tx);
  const arap = getArApSummary(tx);
  // The trained regression is the forecast; the trailing average is only the
  // offline/guest fallback, so both never disagree on screen.
  const fallbackProjection = useMemo(() => predictNextMonthRevenue(tx), [tx]);
  const [modelForecast, setModelForecast] = useState<ForecastResult | null>(null);
  useEffect(() => {
    let active = true;
    if (tx.length === 0) {
      setModelForecast(null);
      return;
    }
    void fetchForecast(tx).then((f) => {
      if (active) setModelForecast(f && f.value > 0 ? f : null);
    });
    return () => {
      active = false;
    };
  }, [tx]);
  const projection = modelForecast
    ? {
        value: modelForecast.value,
        method: modelForecast.method,
        baseline: modelForecast.baseline_value,
      }
    : { value: fallbackProjection.value, method: fallbackProjection.method, baseline: null };
  const slowPending = useSlowPending(!loaded);
  const empty = loaded && mode !== null && tx.length === 0;
  const needsWorkspace = loaded && mode === null;
  const warning = risk.enabled && runway !== null && runway < risk.low_cash_threshold_months;
  const runwayProgress =
    runway === null
      ? 0
      : Math.min(100, Math.max(0, (runway / Math.max(risk.low_cash_threshold_months, 1)) * 100));
  const today = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date());

  return (
    <Page>
      <div className="relative isolate mb-8 flex flex-wrap items-end justify-between gap-4">
        <div className="relative z-10">
          <p className="eyebrow mb-2">
            {today} <span className="mx-1.5 text-slate-300">/</span> Financial overview
          </p>
          <h1 className="text-[2.65rem] leading-[1.15] sm:text-5xl">
            Good to see you<span className="text-accent">.</span>
          </h1>
          <p className="mt-3 lede sm:text-base">Your cash position, without the guesswork.</p>
        </div>
        <Link to="/entry" className="btn btn-solid relative z-10" data-reveal>
          <Plus aria-hidden className="h-4 w-4" /> Add transaction
        </Link>
      </div>

      {warning && (
        <div
          data-reveal
          className="mb-6 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-amber-950 sm:items-center sm:px-5"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
            <ShieldAlert aria-hidden className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Runway is below your safety threshold</p>
            <p className="mt-0.5 text-sm text-amber-800">
              You have {runway!.toFixed(1)} months of runway against your{" "}
              {risk.low_cash_threshold_months}-month target.
            </p>
          </div>
          <Link
            to="/settings"
            className="hidden items-center gap-1 text-sm font-semibold text-amber-900 hover:underline sm:inline-flex"
          >
            Review settings <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      )}

      {needsWorkspace && (
        <div
          data-reveal
          className="mb-6 flex flex-col gap-4 rounded-2xl border border-indigo-100 bg-indigo-50/70 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6"
        >
          <div>
            <p className="eyebrow text-indigo-700">Choose your workspace</p>
            <h2 className="mt-1 text-2xl text-slate-900">
              Start with your own ledger or explore the demo.
            </h2>
            <p className="lede mt-1 max-w-2xl">
              Your dashboard is empty until you sign in or choose guest mode. No figures have been
              assumed.
            </p>
          </div>
          <Link to="/login" className="btn btn-accent shrink-0">
            Continue <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      )}

      {empty && (
        <div
          data-reveal
          className="mb-6 flex flex-col gap-4 rounded-2xl border border-indigo-100 bg-indigo-50/70 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6"
        >
          <div>
            <p className="eyebrow text-indigo-700">A fresh start</p>
            <h2 className="mt-1 text-2xl text-slate-900">
              Your ledger is ready for its first entry.
            </h2>
            <p className="lede mt-1 max-w-2xl">
              Add a transaction to see your cash position, runway and trends. Nothing is assumed.
            </p>
          </div>
          <Link to="/entry" className="btn btn-accent shrink-0">
            Add your first entry <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      )}

      {!loaded ? (
        // Only once the wait is real: a fast load goes straight to the numbers.
        slowPending ? (
          <OverviewSkeleton />
        ) : null
      ) : (
        <>
          <section aria-label="Cash position" className="grid gap-4 lg:grid-cols-12">
            <InteractiveCard
              ribbon={false}
              animateOnMount
              entranceIndex={0}
              data-reveal
              className={`relative overflow-hidden rounded-3xl bg-[#172641] p-6 text-white shadow-[0_16px_40px_rgba(23,38,65,0.14)] sm:p-8 lg:col-span-5 ${warning ? "ring-2 ring-amber-300/70" : ""}`}
            >
              <MovingWave variant="cash" />
              <div
                aria-hidden
                className="absolute -right-10 -top-14 h-52 w-52 rounded-full border border-white/10"
              />
              <div
                aria-hidden
                className="absolute -right-1 -top-5 h-36 w-36 rounded-full border border-white/10"
              />
              <div className="relative flex items-center justify-between">
                <p className="eyebrow text-slate-300">Cash on hand</p>
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-indigo-200">
                  <Landmark aria-hidden className="h-[18px] w-[18px]" />
                </span>
              </div>
              <p className="kpi relative mt-8 text-4xl sm:text-5xl">
                <CountUp value={cash} format={usd} delay={0.15} />
              </p>
              <div className="relative mt-8 border-t border-white/15 pt-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="eyebrow text-slate-400">Estimated runway</p>
                    <p className={`kpi mt-1 text-2xl ${warning ? "text-amber-300" : "text-white"}`}>
                      {runway === null ? (
                        "—"
                      ) : (
                        <CountUp
                          value={runway}
                          format={(value) => `${value.toFixed(1)} mo`}
                          delay={0.3}
                        />
                      )}
                    </p>
                  </div>
                  <span
                    className={`flex h-9 w-9 items-center justify-center rounded-full ${warning ? "bg-amber-400/15 text-amber-300" : "bg-emerald-400/15 text-emerald-300"}`}
                  >
                    {warning ? (
                      <ArrowDownRight aria-hidden className="h-5 w-5" />
                    ) : (
                      <ArrowUpRight aria-hidden className="h-5 w-5" />
                    )}
                  </span>
                </div>
                <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/15">
                  <div
                    className={`h-full rounded-full transition-[width] duration-700 ${warning ? "bg-amber-300" : "bg-emerald-300"}`}
                    style={{ width: `${runwayProgress}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-slate-400">
                  {runway === null
                    ? "Add expense activity to estimate runway"
                    : `Safety target: ${risk.low_cash_threshold_months} months`}
                </p>
              </div>
            </InteractiveCard>

            <div className="relative isolate h-full lg:col-span-7">
              <MovingWave variant="shared" />
              <div className="relative z-10 grid h-full auto-rows-fr gap-4 sm:grid-cols-3">
                <MetricCard
                  label="Open receivables"
                  value={arap.ar}
                  icon={CircleDollarSign}
                  hint={
                    arap.arOverdue > 0 ? `${usd(arap.arOverdue)} overdue` : "No overdue invoices"
                  }
                  tone={arap.arOverdue > 0 ? "warning" : "default"}
                  delay={0.25}
                  entranceIndex={1}
                />
                <MetricCard
                  label="Open payables"
                  value={arap.ap}
                  icon={CreditCard}
                  hint="Bills not yet paid"
                  delay={0.35}
                  entranceIndex={2}
                />
                <InteractiveCard
                  ribbon={false}
                  animateOnMount
                  entranceIndex={3}
                  data-reveal
                  className="surface dashboard-metric-card flex min-h-48 flex-col overflow-hidden p-5"
                >
                  <div className="flex items-center justify-between">
                    <p className="eyebrow">Next month forecast</p>
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                      <Sparkles aria-hidden className="h-[18px] w-[18px]" />
                    </span>
                  </div>
                  <p className="kpi mt-5 text-2xl text-slate-900">
                    {projection.value > 0 ? (
                      <CountUp value={projection.value} format={usd} delay={0.45} />
                    ) : (
                      "—"
                    )}
                  </p>
                  <p className="mt-auto pt-3 text-xs leading-relaxed text-muted-foreground">
                    {projection.value > 0 ? (
                      <>
                        {projection.method}
                        {projection.baseline != null && (
                          <span className="mt-1 block text-[11px] text-muted-foreground/80">
                            Trailing 3-month average: {usd(projection.baseline)}
                          </span>
                        )}
                      </>
                    ) : (
                      "Record income to build a projection."
                    )}
                  </p>
                </InteractiveCard>
              </div>
            </div>
          </section>

          <section className="mt-5 grid gap-5 xl:grid-cols-12">
            <InteractiveCard
              ribbon={false}
              data-scroll
              tilt={0}
              className="surface min-w-0 p-5 sm:p-7 xl:col-span-8"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="eyebrow">Cash movement</p>
                  <h2 className="mt-1 text-3xl">Income &amp; expenses</h2>
                  <p className="mt-1 lede">Monthly totals from your recorded transactions</p>
                </div>
                <div className="flex items-center gap-4 pt-1 text-xs text-slate-600">
                  <span className="inline-flex items-center gap-2">
                    <i className="h-2.5 w-2.5 rounded-full bg-indigo-500" />
                    Income
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <i className="h-2.5 w-2.5 rounded-full bg-teal-500" />
                    Expenses
                  </span>
                </div>
              </div>
              {monthCount > MONTH_WINDOW ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Showing the last {MONTH_WINDOW} months of {monthCount} recorded.
                </p>
              ) : null}
              <CashMovementChart data={monthly} reduceMotion={reduceMotion} />
            </InteractiveCard>

            <InteractiveCard
              ribbon={false}
              data-scroll
              tilt={0}
              className="surface p-5 sm:p-7 xl:col-span-4"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="eyebrow">Receivables</p>
                  <h2 className="mt-1 text-3xl">Aging</h2>
                </div>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                  {usd(arap.ar)} open
                </span>
              </div>
              <div className="mt-7 space-y-5">
                {Object.entries(arap.arAging).map(([bucket, amount], index) => {
                  const labels: Record<string, string> = {
                    current: "Not yet due",
                    "1-30": "1–30 days",
                    "31-60": "31–60 days",
                    "60+": "60+ days",
                  };
                  const percentage = arap.ar > 0 ? (amount / arap.ar) * 100 : 0;
                  return (
                    <div key={bucket}>
                      <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                        <span className="text-slate-600">{labels[bucket] ?? bucket}</span>
                        <span className="tabular-nums text-xs font-medium text-slate-800">
                          {usd(amount)}
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={`h-full rounded-full transition-[width] duration-700 ${index >= 2 ? "bg-amber-400" : "bg-indigo-500"}`}
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              {arap.ar === 0 && (
                <p className="mt-5 rounded-xl bg-slate-50 px-3 py-3 text-xs leading-relaxed text-muted-foreground">
                  No open invoices. When you add receivables, their due-date distribution will show
                  here.
                </p>
              )}
              <div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-4">
                <span className="text-xs text-muted-foreground">Overdue receivables</span>
                <span
                  className={`tabular-nums text-sm font-semibold ${arap.arOverdue > 0 ? "text-rose-600" : "text-slate-700"}`}
                >
                  {usd(arap.arOverdue)}
                </span>
              </div>
            </InteractiveCard>
          </section>

          <section data-scroll className="mt-5 grid gap-5 lg:grid-cols-12">
            <InteractiveCard ribbon={false} tilt={0} className="surface p-5 sm:p-7 lg:col-span-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="eyebrow">Cash planning</p>
                  <h2 className="mt-1 text-3xl">A useful next step</h2>
                </div>
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                  <Sparkles className="h-5 w-5" />
                </span>
              </div>
              <p className="lede mt-3">
                {arap.arOverdue > 0
                  ? `You have ${usd(arap.arOverdue)} in overdue receivables. A quick follow-up could help bring cash in sooner.`
                  : runway !== null && warning
                    ? "Your runway is under the threshold you set. Review upcoming expenses and your risk settings."
                    : "Keep your ledger current to make your runway and monthly trends more useful."}
              </p>
              <Link
                to={arap.arOverdue > 0 ? "/advisor" : "/entry"}
                className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-accent hover:gap-3"
              >
                {arap.arOverdue > 0 ? "Ask the advisor about AR" : "Keep your ledger up to date"}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </InteractiveCard>

            <InteractiveCard ribbon={false} tilt={0} className="surface p-5 sm:p-7 lg:col-span-7">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="eyebrow">External context</p>
                  <h2 className="mt-1 text-3xl">Market snapshot</h2>
                  <p className="mt-1 lede">
                    Qualitative context only — never used in cash calculations.
                  </p>
                </div>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[0.65rem] font-semibold uppercase tracking-wide text-slate-600">
                  Informational
                </span>
              </div>
              {market === undefined ? (
                <div
                  className="mt-5 grid gap-3 sm:grid-cols-2"
                  aria-label="Loading market snapshot"
                  aria-busy="true"
                >
                  {[0, 1, 2, 3].map((item) => (
                    <SkeletonBlock key={item} className="h-[68px] rounded-xl" />
                  ))}
                </div>
              ) : market === null || (!market.indicators.length && !market.headlines.length) ? (
                <div className="mt-5 flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-4">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-slate-500">
                    <Clock3 className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="text-sm font-medium text-slate-700">No snapshot available</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      The cached snapshot could not be loaded from the backend.
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    {market.indicators.map((indicator) => (
                      <div
                        key={indicator.k}
                        className="rounded-xl border border-slate-100 bg-slate-50/70 px-4 py-3"
                      >
                        <p className="eyebrow">{indicator.k}</p>
                        <p className="tabular-nums mt-1 text-base font-semibold text-slate-900">
                          {indicator.v}
                          <span className="ml-2 text-xs font-normal text-muted-foreground">
                            {indicator.d}
                          </span>
                        </p>
                      </div>
                    ))}
                  </div>
                  {market.headlines.length > 0 && (
                    <ul className="mt-4 space-y-2 border-t border-slate-100 pt-4">
                      {market.headlines.slice(0, 3).map((headline) => (
                        <li
                          key={headline}
                          className="lede flex gap-2"
                        >
                          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" />
                          {headline}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </InteractiveCard>
          </section>
        </>
      )}
    </Page>
  );
}

function MetricCard({
  label,
  value,
  icon: Icon,
  hint,
  tone = "default",
  delay,
  entranceIndex,
}: {
  label: string;
  value: number;
  icon: typeof CircleDollarSign;
  hint: string;
  tone?: "default" | "warning";
  delay: number;
  entranceIndex: number;
}) {
  return (
    <InteractiveCard
      ribbon={false}
      animateOnMount
      entranceIndex={entranceIndex}
      data-reveal
      className="surface dashboard-metric-card flex min-h-48 flex-col overflow-hidden p-5"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="eyebrow">{label}</p>
        <span
          className={`flex h-9 w-9 items-center justify-center rounded-xl ${tone === "warning" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600"}`}
        >
          <Icon aria-hidden className="h-[18px] w-[18px]" />
        </span>
      </div>
      <p className="kpi mt-5 text-2xl text-slate-900">
        <CountUp value={value} format={usd} delay={delay} />
      </p>
      <p
        className={`mt-auto pt-3 text-xs ${tone === "warning" ? "font-medium text-amber-700" : "text-muted-foreground"}`}
      >
        {hint}
      </p>
    </InteractiveCard>
  );
}
