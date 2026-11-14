import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Page, Headline } from "@/components/Reveal";
import { CountUp } from "@/components/CountUp";
import { CashChart } from "@/components/CashChart";
import { useStore } from "@/lib/store";
import { getArApSummary, getCashBalance, getMonthly, getRunwayMonths, predictNextMonthRevenue, usd } from "@/lib/calc";
import { fetchArRisk, fetchForecast, fetchMarketSnapshot } from "@/lib/api";
import type { ArRiskFlag } from "@/lib/calc";
import { gsap, useGSAP } from "@/lib/motion";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "Dashboard — CashMonitoring" }, { name: "description", content: "Cash position, runway, AR/AP aging and trend for your business." }, { property: "og:title", content: "CashMonitoring Dashboard" }, { property: "og:description", content: "Cash position, runway and AR/AP at a glance." }] }),
  component: Dashboard,
});

function Dashboard() {
  const { tx, risk, mode, loaded } = useStore();
  // Cached snapshot from the backend job; with none, say so rather than
  // showing invented indicator values.
  const [market, setMarket] = useState<{ indicators: { k: string; v: string; d: string }[]; headlines: string[] }>({ indicators: [], headlines: [] });
  // §11 model outputs — served by the backend, never recomputed in the browser.
  const [forecast, setForecast] = useState<{ value: number; method: string; baseline_value: number | null; target_month?: string } | null>(null);
  const [arRisk, setArRisk] = useState<{
    scored: number; at_risk: number; at_risk_amount: number;
    high_risk: number; high_risk_amount: number; top: ArRiskFlag[];
  } | null>(null);
  useEffect(() => {
    fetchMarketSnapshot().then(s => s && setMarket({ indicators: s.indicators, headlines: s.headlines }));
  }, []);
  const [riskReady, setRiskReady] = useState<"pending" | "ok" | "offline">("pending");
  useEffect(() => {
    let alive = true;
    fetchForecast(tx).then(f => { if (alive && f) setForecast(f); });
    fetchArRisk(tx).then(r => {
      if (!alive) return;
      setArRisk(r);
      setRiskReady(r ? "ok" : "offline");
    });
    return () => { alive = false; };
  }, [tx]);
  const cash = getCashBalance(tx), runway = getRunwayMonths(tx), arap = getArApSummary(tx), pred = predictNextMonthRevenue(tx);
  const empty = loaded && mode !== null && tx.length === 0;
  const warn = risk.enabled && runway !== null && runway < risk.low_cash_threshold_months;
  const banner = useRef<HTMLDivElement>(null);
  useGSAP(() => { if (warn) gsap.from(banner.current, { height: 0, opacity: 0, duration: 0.8, delay: 1, ease: "expo.out" }); }, { dependencies: [warn] });
  const maxAging = Math.max(...Object.values(arap.arAging), 1);
  return (
    <Page>
      <Headline eyebrow="Saturday · 14 November 2026" lines={["The ledger,", "read plainly."]} />
      {warn && <div ref={banner} className="mb-10 overflow-hidden border-l-4 border-warning bg-warning-soft px-5 py-4">
        <p className="eyebrow text-warning">Risk vault</p>
        <p className="mt-1 font-display text-2xl">Runway is {runway!.toFixed(1)} months — under your {risk.low_cash_threshold_months}-month threshold.</p>
      </div>}
      {empty && <div className="mb-10 border-l-4 border-foreground/30 bg-secondary px-5 py-4">
        <p className="eyebrow">Nothing recorded yet</p>
        <p className="mt-1 font-display text-2xl">Your ledger is empty. <Link to="/entry" className="italic text-accent underline underline-offset-4">Add your first entry →</Link></p>
        <p className="mt-1 text-sm text-muted-foreground">Every figure below stays at zero until you enter a transaction — nothing is assumed.</p>
      </div>}
      <section className="grid gap-px bg-border md:grid-cols-4">
        {[["Cash on hand", cash, usd], ["Runway", runway, (n: number) => `${n.toFixed(1)} mo`], ["Open receivables", arap.ar, usd], ["Open payables", arap.ap, usd]].map(([l, v, f], i) => (
          <div key={l as string} data-reveal className="bg-background p-6">
            <p className="eyebrow">{l as string}</p>
            <p className={`mt-3 text-3xl ${i === 1 && warn ? "text-warning" : ""}`}>
              {v === null ? <span className="text-muted-foreground">—</span> : <CountUp value={v as number} format={f as (n: number) => string} delay={0.4 + i * 0.1} />}
            </p>
          </div>))}
      </section>
      <section data-scroll className="mt-16 grid gap-10 md:grid-cols-3">
        <div className="md:col-span-2">
          <div className="flex items-baseline justify-between"><h2 className="text-3xl">Six months of flow</h2><p className="eyebrow"><span className="text-accent">━</span> income &nbsp; ┅ expense &nbsp; ▮ net</p></div>
          <CashChart data={getMonthly(tx)} />
        </div>
        <aside className="border-l pl-6">
          <p className="eyebrow">Projection · {forecast?.target_month ?? "next month"}</p>
          <p className="mt-2 text-4xl">{(forecast?.value ?? pred.value) ? <CountUp value={forecast?.value ?? pred.value} format={usd} /> : <span className="text-muted-foreground">—</span>}</p>
          <p className="mt-2 text-sm text-muted-foreground">{forecast ? forecast.method : pred.value ? `${pred.method}.` : "Needs recorded income before a projection can be made."}</p>
          {forecast?.baseline_value != null && (
            <p className="mt-1 text-xs text-muted-foreground">Rule of thumb (next month = this month): <span className="num">{usd(forecast.baseline_value)}</span></p>
          )}
          <div className="rule my-6" />
          <p className="eyebrow">Overdue AR</p>
          <p className="mt-2 text-2xl text-destructive">{arap.arOverdue ? <CountUp value={arap.arOverdue} format={usd} /> : <span className="text-muted-foreground">—</span>}</p>
        </aside>
      </section>
      <section data-scroll className="mt-16 grid gap-10 md:grid-cols-2">
        <div>
          <h2 className="text-3xl">Receivables aging</h2>
          {arap.ar === 0 && <p className="mt-4 text-sm text-muted-foreground">No open invoices yet.</p>}
          <div className="mt-6 space-y-4">{Object.entries(arap.arAging).map(([k, v]) => (
            <div key={k}><div className="flex justify-between text-sm"><span className="num">{k === "current" ? "Not yet due" : `${k} days`}</span><span className="num">{usd(v)}</span></div>
              <div className="mt-1 h-2 bg-secondary"><AgingBar pct={v / maxAging} /></div></div>))}</div>
        </div>
        <div>
          <h2 className="text-3xl">AR at risk of late payment</h2>
          <p className="text-sm text-muted-foreground">Scored by the trained classifier on amount, terms, category and each customer's own late history.</p>
          {riskReady === "offline" ? (
            <p className="mt-6 text-sm text-muted-foreground">Risk scoring needs the backend running — start <code>uvicorn app.main:app</code> in <code>backend/</code>.</p>
          ) : !arRisk || arRisk.scored === 0 ? (
            <p className="mt-6 text-sm text-muted-foreground">{riskReady === "ok" ? "No open receivables to score." : "Scoring your receivables…"}</p>
          ) : (
            <>
              <p className="mt-4 text-sm">
                <span className="num text-2xl">{arRisk.high_risk}</span> high-risk of {arRisk.scored} open invoices —{" "}
                <span className="num">{usd(arRisk.high_risk_amount)}</span>. The rest are watch-only.
              </p>
              <ul className="mt-4 divide-y border-t">
                {arRisk.top.slice(0, 4).map(f => (
                  <li key={`${f.vendor_or_customer}-${f.due_date}`} className="flex items-baseline justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate">{f.vendor_or_customer}</p>
                      <p className="eyebrow">
                        {f.status} · {f.days_until_due < 0 ? `${Math.abs(f.days_until_due)}d overdue` : `due in ${f.days_until_due}d`}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="num">{usd(f.amount)}</p>
                      <p className={`eyebrow ${f.severity === "high" ? "text-destructive" : "text-muted-foreground"}`}>
                        {Math.round(f.p_late * 100)}% late · {f.severity}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-muted-foreground">
                Prototype model on synthetic data — a prompt to look closer, not a credit decision.
              </p>
            </>
          )}
        </div>
        <div>
          <h2 className="text-3xl">Market colour</h2>
          <p className="text-sm text-muted-foreground">Qualitative context only — never used in calculations.</p>
          {market.indicators.length === 0 && market.headlines.length === 0
            ? <p className="mt-6 text-sm text-muted-foreground">No market snapshot yet — run the snapshot job (see backend/README.md).</p>
            : <>
              <div className="mt-6 grid grid-cols-2 gap-4">{market.indicators.map(m => <div key={m.k} className="border-t pt-2"><p className="eyebrow">{m.k}</p><p className="num text-lg">{m.v} <span className="text-xs text-muted-foreground">{m.d}</span></p></div>)}</div>
              <ul className="mt-6 space-y-2 font-display text-lg italic">{market.headlines.map(h => <li key={h}>“{h}”</li>)}</ul>
            </>}
        </div>
      </section>
    </Page>
  );
}
function AgingBar({ pct }: { pct: number }) {
  const r = useRef<HTMLDivElement>(null);
  useGSAP(() => { gsap.fromTo(r.current, { scaleX: 0 }, { scaleX: pct, transformOrigin: "left", duration: 1.4, ease: "expo.out", scrollTrigger: { trigger: r.current, start: "top 90%" } }); });
  return <div ref={r} className="h-full w-full bg-accent" />;
}
