// Scored models: the trained revenue regression and the AR late-payment
// classifier, surfaced for the first time. Every figure here comes from an
// existing endpoint — POST /api/forecast, POST /api/ar/risk and
// GET /api/models/info — with the ledger posted in the body so guest mode works.
// Nothing is recomputed in the browser: `calc.getMonthly` is only used to draw
// the context bars, and the UI says so.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  CircleSlash,
  RefreshCw,
  TrendingUp,
} from "lucide-react";
import { ForcedEntrance } from "@/components/ForcedEntrance";
import { Headline, Page } from "@/components/Reveal";
import { SkeletonBlock } from "@/components/Skeleton";
import { useSlowPending } from "@/lib/use-slow-pending";
import { getMonthly, usd } from "@/lib/calc";
import {
  fetchArRisk,
  fetchForecast,
  fetchModelsInfo,
  type ArRiskSummary,
  type ArModelMetrics,
  type ForecastResult,
  type ModelInfo,
  type RevenueModelMetrics,
} from "@/lib/api";
import {
  deltaVsBaseline,
  dueLabel,
  formatMonth,
  lateHistory,
  pct,
  severityChipClass,
  severityLabel,
  signedPct,
  topNStatement,
} from "@/lib/insights";
import { useStore } from "@/lib/store";

export const Route = createFileRoute("/insights")({
  head: () => ({
    meta: [
      { title: "Model insights — Cashflow" },
      {
        name: "description",
        content:
          "Next-month revenue projection and receivable late-payment risk, with the held-out metrics behind both models.",
      },
    ],
  }),
  component: InsightsPage,
});

type Status = "loading" | "ready" | "error";

function InsightsPage() {
  const { tx, loaded } = useStore();
  const [status, setStatus] = useState<Status>("loading");
  const [forecast, setForecast] = useState<ForecastResult | null>(null);
  const [risk, setRisk] = useState<ArRiskSummary | null>(null);
  const [info, setInfo] = useState<ModelInfo | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!loaded) return;
    let alive = true;
    setStatus("loading");
    void Promise.all([fetchForecast(tx), fetchArRisk(tx), fetchModelsInfo()]).then(
      ([nextForecast, nextRisk, nextInfo]) => {
        if (!alive) return;
        setForecast(nextForecast);
        setRisk(nextRisk);
        setInfo(nextInfo);
        setStatus(nextForecast || nextRisk || nextInfo ? "ready" : "error");
      },
    );
    return () => {
      alive = false;
    };
  }, [tx, loaded, attempt]);

  // Context bars only — read from the ledger, never presented as model output.
  const monthly = useMemo(() => getMonthly(tx), [tx]);
  const lastMonth = monthly.at(-1) ?? null;
  const lastIncome = lastMonth?.income ?? 0;
  const trailing = monthly.slice(-3);
  const trailingAvg = trailing.length
    ? trailing.reduce((total, month) => total + month.income, 0) / trailing.length
    : 0;

  const revenueMetrics = info?.metrics.revenue ?? null;
  const arMetrics = info?.metrics.ar_risk ?? null;

  return (
    <Page>
      <Headline eyebrow="Scored models" lines={["Forecast & risk,", "with the receipts."]} />

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" data-reveal>
        <div className="flex flex-wrap items-center gap-2">
          <ModelBadge
            label="Revenue model"
            ready={info?.revenue_forecast ?? false}
            unknown={!info}
          />
          <ModelBadge label="AR risk model" ready={info?.ar_risk ?? false} unknown={!info} />
          {info?.metrics.generated_at && (
            <span className="text-xs text-slate-500">
              trained {formatTrainedAt(info.metrics.generated_at)}
            </span>
          )}
        </div>
        {revenueMetrics?.rows && arMetrics?.rows && (
          <p className="text-xs text-slate-500">
            {revenueMetrics.rows.total.toLocaleString("en-US")} revenue rows ·{" "}
            {arMetrics.rows.total.toLocaleString("en-US")} receivable rows
          </p>
        )}
      </div>

      {status === "error" && (
        <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50/70 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2 text-sm text-amber-900">
            <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
            The model service is unreachable, so no score is shown — nothing is estimated in the
            browser. Your ledger figures below are still read from this session.
          </p>
          <button
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
            className="btn shrink-0 text-sm"
          >
            <RefreshCw aria-hidden className="h-4 w-4" /> Retry
          </button>
        </div>
      )}

      <div className="grid items-start gap-5 xl:grid-cols-12">
        <ForcedEntrance
          index={0}
          className="surface min-w-0 rounded-3xl border border-slate-200/80 bg-white p-5 sm:p-7 xl:col-span-7"
        >
          <ProjectionCard
            status={status}
            forecast={forecast}
            lastMonthLabel={formatMonth(lastMonth?.month ?? null)}
            lastIncome={lastIncome}
            trailingAvg={trailingAvg}
          />
        </ForcedEntrance>

        <ForcedEntrance
          index={1}
          className="surface min-w-0 rounded-3xl border border-slate-200/80 bg-white p-5 sm:p-7 xl:col-span-5"
        >
          <RiskCard status={status} risk={risk} />
        </ForcedEntrance>
      </div>

      <ForcedEntrance
        index={2}
        className="surface mt-5 overflow-hidden rounded-3xl border border-slate-200/80 bg-white"
      >
        <RiskQueue status={status} risk={risk} />
      </ForcedEntrance>

      <section className="mt-5 grid items-start gap-5 lg:grid-cols-2" aria-label="How the models work">
        <ForcedEntrance index={3} className="surface rounded-3xl border border-slate-200/80 bg-white p-5 sm:p-7">
          <RevenueReceipts metrics={revenueMetrics} loaded={info?.revenue_forecast ?? false} />
        </ForcedEntrance>
        <ForcedEntrance index={4} className="surface rounded-3xl border border-slate-200/80 bg-white p-5 sm:p-7">
          <ArReceipts metrics={arMetrics} loaded={info?.ar_risk ?? false} />
        </ForcedEntrance>
      </section>

      <p className="mt-6 text-xs leading-relaxed text-slate-500" data-reveal>
        A projection is not a guarantee, and a risk score is not a decision. Both models are scored
        server-side from the ledger shown here; when a trained artifact is missing the backend falls
        back to a documented rule and this page labels it as a rule rather than a prediction. Failure
        cases are published on purpose.
      </p>
    </Page>
  );
}

/* -------------------------------------------------------------------------- */
/* projection                                                                  */
/* -------------------------------------------------------------------------- */

function ProjectionCard({
  status,
  forecast,
  lastMonthLabel,
  lastIncome,
  trailingAvg,
}: {
  status: Status;
  forecast: ForecastResult | null;
  lastMonthLabel: string;
  lastIncome: number;
  trailingAvg: number;
}) {
  // "none" is not a fallback: it means there is no income to project from, and
  // labelling it as a rule would dress up missing data as a method.
  // A quick answer shows the numbers only; placeholders wait for a real delay.
  const slowPending = useSlowPending(status === "loading");
  const isFallback = forecast?.source === "fallback_trailing_average";
  const empty = forecast ? forecast.source === "none" || !forecast.target_month : false;
  const sourceLabel = forecast?.source === "model"
    ? "trained model"
    : isFallback
      ? "fallback · trailing average"
      : null;
  const bars = [
    { label: lastMonthLabel === "—" ? "Last month" : lastMonthLabel, value: lastIncome, model: false },
    { label: "3-month average", value: trailingAvg, model: false },
    { label: "Projection", value: forecast?.value ?? 0, model: true },
  ];
  const maxBar = Math.max(...bars.map((bar) => bar.value), 1);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow">Next-month revenue</p>
          <p className="mt-1 text-sm text-slate-500">
            {forecast?.target_month ? formatMonth(forecast.target_month) : "—"}
          </p>
        </div>
        {sourceLabel && !empty && (
          <span
            className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
              isFallback
                ? "border-amber-200 bg-amber-50 text-amber-700"
                : "border-indigo-200 bg-indigo-50 text-indigo-700"
            }`}
          >
            {sourceLabel}
          </span>
        )}
      </div>

      {status === "loading" ? (
        !slowPending ? null : (
          <div aria-busy="true">
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <Skeleton className="h-12 w-44" />
              <Skeleton className="h-7 w-16 rounded-full" />
            </div>
            <ul className="mt-6 space-y-3">
              {[0, 1, 2].map((bar) => (
                <li key={bar} className="grid grid-cols-[7.5rem_1fr_auto] items-center gap-3">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-2 w-full rounded-full" />
                  <Skeleton className="h-3 w-16" />
                </li>
              ))}
            </ul>
            <span className="sr-only" role="status">
              Loading the revenue projection
            </span>
          </div>
        )
      ) : !forecast ? (
        <Unavailable text="The forecast endpoint did not respond." />
      ) : empty ? (
        <EmptyState
          icon={TrendingUp}
          title="Nothing to forecast from"
          body="Record at least one month of income and the regression can project the next one."
        />
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <p className={`num text-4xl font-semibold tracking-tight sm:text-5xl ${isFallback ? "text-amber-700" : "text-slate-900"}`}>
              {usd(forecast.value)}
            </p>
            <DeltaPill value={forecast.value} baseline={forecast.baseline_value} />
          </div>

          <ul className="mt-6 space-y-3">
            {bars.map((bar) => (
              <li key={bar.label} className="grid grid-cols-[7.5rem_1fr_auto] items-center gap-3">
                <span className={`truncate text-xs ${bar.model ? "font-semibold text-indigo-700" : "text-slate-500"}`}>
                  {bar.label}
                </span>
                <span className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <span
                    className={`block h-full rounded-full ${bar.model ? "bg-indigo-500" : "bg-slate-300"}`}
                    style={{ width: `${Math.max((bar.value / maxBar) * 100, bar.value > 0 ? 3 : 0)}%` }}
                  />
                </span>
                <span className="num w-20 text-right text-xs font-semibold text-slate-700">
                  {usd(bar.value)}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
            The two context bars are read from this session&apos;s ledger; the projection comes from
            the model.
          </p>

          <div className="mt-5 rounded-2xl bg-slate-50 p-4">
            <p className="eyebrow mb-1.5">How it&apos;s computed</p>
            <p className="text-xs leading-relaxed text-slate-600">{forecast.method}</p>
            {forecast.baseline_value !== null && (
              <p className="mt-2 text-[11px] text-slate-500">
                Baseline (persistence: next month = this month) would say{" "}
                <span className="num font-semibold text-slate-700">{usd(forecast.baseline_value)}</span>.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function DeltaPill({ value, baseline }: { value: number; baseline: number | null }) {
  const delta = deltaVsBaseline(value, baseline);
  if (delta === null) return null;
  const up = delta >= 0;
  return (
    <span
      className={`mb-1 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${
        up ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
      }`}
    >
      {signedPct(delta)} vs persistence
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* risk summary                                                                */
/* -------------------------------------------------------------------------- */

function RiskCard({ status, risk }: { status: Status; risk: ArRiskSummary | null }) {
  const slowPending = useSlowPending(status === "loading");
  const threshold = risk?.top[0]?.threshold ?? null;
  const flaggedShare = risk && risk.open_amount > 0 ? risk.at_risk_amount / risk.open_amount : 0;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="eyebrow">Receivable risk</p>
        {threshold !== null && (
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600">
            threshold {threshold.toFixed(2)}
          </span>
        )}
      </div>

      {status === "loading" ? (
        !slowPending ? null : (
          <div className="mt-4 grid grid-cols-2 gap-3" aria-busy="true">
            {[0, 1, 2, 3].map((key) => (
              <div key={key} className="rounded-xl border border-slate-100 px-3 py-2.5">
                <Skeleton className="h-2.5 w-16" />
                <Skeleton className="mt-2 h-5 w-12" />
              </div>
            ))}
            <span className="sr-only" role="status">
              Loading receivable risk scores
            </span>
          </div>
        )
      ) : !risk ? (
        <Unavailable text="The risk endpoint did not respond." />
      ) : risk.scored === 0 ? (
        <EmptyState
          icon={BadgeCheck}
          title="Nothing open to score"
          body="Settled invoices aren't re-scored — add an open receivable and it will be ranked here."
        />
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Tile label="At risk" value={String(risk.at_risk)} hint={`of ${risk.scored} scored`} />
            <Tile label="Flagged amount" value={usd(risk.at_risk_amount)} tone="amber" />
            <Tile label="High risk" value={String(risk.high_risk)} hint={usd(risk.high_risk_amount)} tone="rose" />
            <Tile label="Open AR" value={usd(risk.open_amount)} hint="scored rows" />
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between text-[11px] text-slate-500">
              <span>Share of open AR flagged</span>
              <span className="num font-semibold text-slate-700">{pct(flaggedShare)}</span>
            </div>
            <div
              role="progressbar"
              aria-label="Share of open receivables flagged as at risk"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(flaggedShare * 100)}
              className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100"
            >
              <span
                className="block h-full rounded-full bg-amber-500"
                style={{ width: `${Math.max(flaggedShare * 100, risk.at_risk > 0 ? 3 : 0)}%` }}
              />
            </div>
          </div>

          {(risk.overdue_count ?? 0) > 0 && (
            <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-[11px] leading-relaxed text-rose-800">
              <span className="font-semibold">
                {risk.overdue_count} already overdue — {usd(risk.overdue_amount ?? 0)}.
              </span>{" "}
              Late is a fact for these, so their risk reads 100% and they are ordered by
              amount × days overdue.{" "}
              {(risk.predicted_high_count ?? 0) === 1
                ? `The other flagged row (${usd(risk.predicted_high_amount ?? 0)}) is not yet due — that percentage is the model's forecast.`
                : `The other ${risk.predicted_high_count ?? 0} flagged rows (${usd(risk.predicted_high_amount ?? 0)}) are not yet due — those percentages are the model's forecast.`}
            </p>
          )}

          <p className="mt-4 text-[11px] leading-relaxed text-slate-500">{risk.method}</p>
        </>
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  hint,
  tone = "slate",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "slate" | "amber" | "rose";
}) {
  const toneClass =
    tone === "amber" ? "text-amber-700" : tone === "rose" ? "text-rose-700" : "text-slate-900";
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-slate-50/60 p-3.5">
      <p className="text-[11px] font-medium text-slate-500">{label}</p>
      <p className={`num mt-1.5 text-xl font-semibold tracking-tight ${toneClass}`}>{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* risk queue                                                                  */
/* -------------------------------------------------------------------------- */

function RiskQueue({ status, risk }: { status: Status; risk: ArRiskSummary | null }) {
  const slowPending = useSlowPending(status === "loading");
  const rows = risk?.top ?? [];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4 sm:p-5">
        <div>
          <p className="eyebrow">Risk queue</p>
          <h2 className="mt-1 text-2xl">Who to chase first</h2>
        </div>
        {risk && (
          <p className="text-xs text-slate-500">{topNStatement(rows.length, risk.scored)}</p>
        )}
      </div>

      {status === "loading" ? (
        !slowPending ? null : (
          <div className="space-y-3 p-5" aria-busy="true">
            {[0, 1, 2].map((key) => (
              <Skeleton key={key} className="h-14" />
            ))}
            <span className="sr-only" role="status">
              Loading the risk queue
            </span>
          </div>
        )
      ) : !risk || rows.length === 0 ? (
        <div className="px-5 py-14 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
            {risk ? <CircleSlash aria-hidden className="h-5 w-5" /> : <AlertTriangle aria-hidden className="h-5 w-5" />}
          </span>
          <h3 className="mt-4 text-lg font-semibold text-slate-800">
            {risk ? "No open receivables" : "Scores unavailable"}
          </h3>
          <p className="lede mx-auto mt-1 max-w-md">
            {risk
              ? "Only open rows are scored — settled invoices have nothing left to chase."
              : "The risk endpoint did not respond, so nothing is ranked rather than ranked wrongly."}
          </p>
          {risk && (
            <Link to="/entry" className="btn btn-solid mt-5">
              Add a receivable <ArrowRight aria-hidden className="h-4 w-4" />
            </Link>
          )}
        </div>
      ) : (
        <>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[760px] text-left">
              <thead className="bg-slate-50/80 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                <tr>
                  <th scope="col" className="px-5 py-3">Customer</th>
                  <th scope="col" className="px-5 py-3">Amount</th>
                  <th scope="col" className="px-5 py-3">Due</th>
                  <th scope="col" className="px-5 py-3">Category</th>
                  <th scope="col" className="px-5 py-3">Late history</th>
                  <th scope="col" className="px-5 py-3">Risk</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => (
                  <tr key={row.id ?? `${row.vendor_or_customer}-${row.amount}`} className="transition-colors hover:bg-slate-50/70">
                    <td className="px-5 py-4">
                      <p className="truncate font-medium text-slate-800">
                        {row.vendor_or_customer || "Unnamed customer"}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        {row.status === "overdue" ? "overdue" : "pending"}
                      </p>
                    </td>
                    <td className="num px-5 py-4 font-semibold text-slate-800">{usd(row.amount)}</td>
                    <td className="px-5 py-4">
                      <DueText days={row.days_until_due} dueDate={row.due_date} />
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-600">{row.category || "—"}</td>
                    <td className="px-5 py-4 text-xs text-slate-600">
                      {lateHistory(row.customer_historical_late_rate, row.customer_prior_count)}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <RiskMeter
                          value={row.p_late}
                          threshold={row.threshold}
                          customer={row.vendor_or_customer}
                          alreadyLate={row.already_late ?? false}
                        />
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${severityChipClass(row.severity)}`}
                        >
                          {severityLabel(row.severity)}
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="divide-y divide-slate-100 sm:hidden">
            {rows.map((row) => (
              <li key={row.id ?? `${row.vendor_or_customer}-${row.amount}`} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-800">
                      {row.vendor_or_customer || "Unnamed customer"}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-500">{row.category || "—"}</p>
                  </div>
                  <p className="num shrink-0 text-sm font-semibold text-slate-800">{usd(row.amount)}</p>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
                  <DueText days={row.days_until_due} dueDate={row.due_date} />
                  <span className="text-slate-500">
                    {lateHistory(row.customer_historical_late_rate, row.customer_prior_count)}
                  </span>
                  <span
                    className={`rounded-full border px-2 py-0.5 font-semibold uppercase tracking-wide ${severityChipClass(row.severity)}`}
                  >
                    {severityLabel(row.severity)}
                  </span>
                </div>
                <div className="mt-2">
                  <RiskMeter
                    value={row.p_late}
                    threshold={row.threshold}
                    customer={row.vendor_or_customer}
                    alreadyLate={row.already_late ?? false}
                  />
                </div>
              </li>
            ))}
          </ul>

          {risk && (
            <p className="border-t border-slate-100 px-5 py-3 text-[11px] leading-relaxed text-slate-500">
              {risk.method}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function DueText({ days, dueDate }: { days: number; dueDate: string | null }) {
  const { text, tone } = dueLabel(days);
  const toneClass =
    tone === "overdue" ? "text-rose-700" : tone === "today" ? "text-amber-700" : "text-slate-600";
  return (
    <span className={`text-xs font-medium ${toneClass}`} title={dueDate ?? undefined}>
      {text}
    </span>
  );
}

/** p_late meter with the model's own threshold marked, filled by the Web
 *  Animations API so it is not suppressed by the reduced-motion reset. */
function RiskMeter({
  value,
  threshold,
  customer,
  alreadyLate = false,
}: {
  value: number;
  threshold: number;
  customer: string;
  alreadyLate?: boolean;
}) {
  const fillRef = useRef<HTMLSpanElement>(null);
  const ratio = Math.max(0, Math.min(1, value));

  useEffect(() => {
    const el = fillRef.current;
    if (!el || typeof el.animate !== "function") return;
    const anim = el.animate([{ width: "0%" }, { width: `${ratio * 100}%` }], {
      duration: 620,
      delay: 200,
      easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      fill: "both",
    });
    return () => anim.cancel();
  }, [ratio]);

  const tone = ratio >= threshold + 0.12 ? "bg-rose-500" : ratio >= threshold ? "bg-amber-500" : "bg-emerald-500";

  return (
    <div className="flex items-center gap-2">
      <div
        role="progressbar"
        aria-label={
          alreadyLate
            ? `${customer || "This customer"} is already overdue — risk is 100% by definition`
            : `Predicted late-payment risk for ${customer || "this customer"}`
        }
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(ratio * 100)}
        title={
          alreadyLate
            ? "Already past due: late by definition, ranked by amount x days overdue"
            : `Threshold ${threshold.toFixed(2)}`
        }
        className="relative h-1.5 w-[72px] overflow-hidden rounded-full bg-slate-100"
      >
        <span ref={fillRef} className={`absolute inset-y-0 left-0 rounded-full ${tone}`} />
        <span
          aria-hidden
          className="absolute inset-y-[-2px] w-px bg-slate-500/70"
          style={{ left: `${threshold * 100}%` }}
        />
      </div>
      <span className="num w-9 text-right text-xs font-semibold text-slate-700">{pct(ratio)}</span>
      {alreadyLate && (
        <span className="whitespace-nowrap text-[10px] font-medium uppercase tracking-wide text-rose-600">
          late
        </span>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* receipts                                                                    */
/* -------------------------------------------------------------------------- */

const FEATURE_LABELS: Record<string, string> = {
  prev_month: "Previous month",
  trailing_3mo_avg: "3-month average",
  ar_overdue_ratio_prev: "Overdue AR share",
  sin: "Seasonality (sin)",
  cos: "Seasonality (cos)",
  log_amount: "Amount (log)",
  days_until_due: "Days until due",
  customer_historical_late_rate: "Customer late rate",
  customer_prior_count: "Prior AR count",
};

function featureLabel(key: string): string {
  return FEATURE_LABELS[key] ?? key.replace(/^cat_/, "").replace(/_/g, " ");
}

function RevenueReceipts({
  metrics,
  loaded,
}: {
  metrics: RevenueModelMetrics | null;
  loaded: boolean;
}) {
  const modelMae = metrics?.model_metrics?.mae ?? null;
  const baselineMae = metrics?.baseline?.mae ?? null;
  const coefficients = Object.entries(metrics?.coefficients ?? {}).sort(
    (a, b) => Math.abs(b[1]) - Math.abs(a[1]),
  );

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="eyebrow">Revenue model</p>
          <h2 className="mt-1 text-2xl">Next-month regression</h2>
        </div>
        <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700">
          {metrics?.model ?? "LinearRegression"}
        </span>
      </div>

      {!loaded && (
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2 text-[11px] text-amber-800">
          The trained artifact is not on this machine, so the API is returning the documented
          trailing-average rule instead of a prediction.
        </p>
      )}

      <dl className="mt-5 grid grid-cols-3 gap-3">
        <Metric label="Held-out MAE" value={modelMae === null ? "—" : usd(modelMae)} />
        <Metric label="Persistence MAE" value={baselineMae === null ? "—" : usd(baselineMae)} />
        <Metric
          label="Improvement"
          value={metrics?.improvement_pct === undefined ? "—" : signedPct(metrics.improvement_pct)}
          tone="positive"
        />
      </dl>

      {coefficients.length > 0 && (
        <div className="mt-5">
          <p className="eyebrow mb-2">Weights</p>
          <ul className="space-y-1.5">
            {coefficients.slice(0, 5).map(([key, value]) => (
              <li key={key} className="flex items-baseline justify-between gap-3 text-xs">
                <span className="text-slate-600">{featureLabel(key)}</span>
                <span className="num shrink-0 font-semibold text-slate-800">
                  {value.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
            A negative overdue-AR weight is the fused signal: receivables slipping last month pull
            the projection down.
          </p>
        </div>
      )}

      {metrics?.failure_case && (
        <div className="mt-5 rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3.5">
          <p className="eyebrow mb-1 flex items-center gap-1.5">
            <AlertTriangle aria-hidden className="h-3 w-3" /> Where it breaks
          </p>
          <p className="text-xs leading-relaxed text-slate-600">
            {formatMonth(metrics.failure_case.month)}: predicted{" "}
            <span className="num font-semibold">{usd(metrics.failure_case.predicted)}</span>, actual{" "}
            <span className="num font-semibold">{usd(metrics.failure_case.actual)}</span> (off by{" "}
            <span className="num">{usd(metrics.failure_case.error)}</span>). {metrics.failure_case.hypothesis}
          </p>
        </div>
      )}
    </div>
  );
}

function ArReceipts({ metrics, loaded }: { metrics: ArModelMetrics | null; loaded: boolean }) {
  const baseline = metrics?.baseline ?? null;
  const model = metrics?.model_metrics ?? null;
  const matrix = metrics?.confusion_matrix ?? null;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="eyebrow">Receivable risk model</p>
          <h2 className="mt-1 text-2xl">Late-payment classifier</h2>
        </div>
        <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700">
          LogisticRegression
        </span>
      </div>

      {!loaded && (
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2 text-[11px] text-amber-800">
          The trained artifact is not on this machine, so the API is returning a documented rule, not
          a model probability.
        </p>
      )}

      {baseline && (
        <div className="mt-4 rounded-2xl border border-amber-200/70 bg-amber-50/50 p-3.5">
          <p className="text-[11px] font-semibold text-amber-900">
            Why accuracy alone would mislead here
          </p>
          <p className="mt-1 text-xs leading-relaxed text-amber-900/90">
            The &ldquo;always on time&rdquo; baseline scores{" "}
            <span className="num font-semibold">{pct(baseline.accuracy)}</span> accuracy while catching{" "}
            <span className="num font-semibold">
              {baseline.late_caught} of {baseline.late_actual}
            </span>{" "}
            late payers. The model trades accuracy for recall on purpose.
          </p>
        </div>
      )}

      <dl className="mt-4 grid grid-cols-3 gap-3">
        <Metric label="Recall (late)" value={model ? pct(model.recall) : "—"} />
        <Metric label="Precision" value={model ? pct(model.precision) : "—"} />
        <Metric label="F1" value={model ? model.f1.toFixed(3) : "—"} />
      </dl>

      {matrix && (
        <div className="mt-5">
          <p className="eyebrow mb-2">Held-out confusion matrix</p>
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <div className="grid grid-cols-[auto_1fr_1fr] text-center text-[11px]">
              <span className="bg-slate-50 px-2 py-1.5" />
              <span className="bg-slate-50 px-2 py-1.5 font-semibold text-slate-600">pred. on time</span>
              <span className="bg-slate-50 px-2 py-1.5 font-semibold text-slate-600">pred. late</span>

              <span className="bg-slate-50 px-2 py-1.5 font-semibold text-slate-600">on time</span>
              <span className="num px-2 py-2 text-slate-700">{matrix.true_negative}</span>
              <span className="num px-2 py-2 text-rose-700">{matrix.false_positive}</span>

              <span className="bg-slate-50 px-2 py-1.5 font-semibold text-slate-600">late</span>
              <span className="num px-2 py-2 text-rose-700">{matrix.false_negative}</span>
              <span className="num px-2 py-2 font-semibold text-emerald-700">{matrix.true_positive}</span>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            Decision threshold {metrics?.threshold?.toFixed(2) ?? "—"}
            {metrics?.threshold_tuned_on ? `, tuned on the ${metrics.threshold_tuned_on}` : ""}.
          </p>
        </div>
      )}

      {metrics?.features && metrics.features.length > 0 && (
        <div className="mt-4">
          <p className="eyebrow mb-2">Features</p>
          <ul className="flex flex-wrap gap-1.5">
            {metrics.features.map((feature) => (
              <li
                key={feature}
                className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-600"
              >
                {featureLabel(feature)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {metrics?.failure_case && (
        <div className="mt-5 rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3.5">
          <p className="eyebrow mb-1 flex items-center gap-1.5">
            <AlertTriangle aria-hidden className="h-3 w-3" /> Where it breaks
          </p>
          <p className="text-xs leading-relaxed text-slate-600">
            {metrics.failure_case.vendor_or_customer} ({usd(metrics.failure_case.amount)}) scored{" "}
            <span className="num font-semibold">{pct(metrics.failure_case.p_late)}</span> late risk but
            paid late anyway. {metrics.failure_case.hypothesis}
          </p>
        </div>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "positive";
}) {
  return (
    <div>
      <dt className="text-[11px] text-slate-500">{label}</dt>
      <dd
        className={`num mt-1 text-base font-semibold ${tone === "positive" ? "text-emerald-700" : "text-slate-900"}`}
      >
        {value}
      </dd>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* small shared pieces                                                         */
/* -------------------------------------------------------------------------- */

function ModelBadge({
  label,
  ready,
  unknown,
}: {
  label: string;
  ready: boolean;
  unknown: boolean;
}) {
  const tone = unknown
    ? "border-slate-200 bg-white text-slate-500"
    : ready
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : "border-amber-200 bg-amber-50 text-amber-700";
  const text = unknown ? "checking" : ready ? "loaded" : "fallback rule";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${tone}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${ready && !unknown ? "bg-emerald-500" : "bg-current"}`} />
      {label} · {text}
    </span>
  );
}

/** Placeholder block: same shimmer as the rest of the app (see components/Skeleton). */
function Skeleton({ className = "" }: { className?: string }) {
  return <SkeletonBlock className={`rounded-xl ${className}`} />;
}

function Unavailable({ text }: { text: string }) {
  return (
    <div className="mt-5 rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-center">
      <AlertTriangle aria-hidden className="mx-auto h-5 w-5 text-amber-500" />
      <p className="mt-2 text-sm font-medium text-slate-700">Not available</p>
      <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-slate-500">{text}</p>
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof TrendingUp;
  title: string;
  body: string;
}) {
  return (
    <div className="mt-5 rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center">
      <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
        <Icon aria-hidden className="h-5 w-5" />
      </span>
      <p className="mt-3 text-sm font-semibold text-slate-800">{title}</p>
      <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-slate-500">{body}</p>
      <Link to="/entry" className="btn mt-4 text-xs">
        Add a transaction <ArrowRight aria-hidden className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}

function formatTrainedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", year: "numeric" }).format(
    date,
  );
}
