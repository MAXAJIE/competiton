import { createFileRoute } from "@tanstack/react-router";
import { useRef } from "react";
import { Page, Headline } from "@/components/Reveal";
import { CountUp } from "@/components/CountUp";
import { CashChart } from "@/components/CashChart";
import { useStore } from "@/lib/store";
import { getArApSummary, getCashBalance, getMonthly, getRunwayMonths, predictNextMonthRevenue, usd } from "@/lib/calc";
import { demoMarket } from "@/lib/demo-data";
import { gsap, useGSAP } from "@/lib/motion";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "Dashboard — CashMonitoring" }, { name: "description", content: "Cash position, runway, AR/AP aging and trend for your business." }, { property: "og:title", content: "CashMonitoring Dashboard" }, { property: "og:description", content: "Cash position, runway and AR/AP at a glance." }] }),
  component: Dashboard,
});

function Dashboard() {
  const { tx, risk } = useStore();
  const cash = getCashBalance(tx), runway = getRunwayMonths(tx), arap = getArApSummary(tx), pred = predictNextMonthRevenue(tx);
  const warn = risk.enabled && runway < risk.low_cash_threshold_months;
  const banner = useRef<HTMLDivElement>(null);
  useGSAP(() => { if (warn) gsap.from(banner.current, { height: 0, opacity: 0, duration: 0.8, delay: 1, ease: "expo.out" }); }, { dependencies: [warn] });
  const maxAging = Math.max(...Object.values(arap.arAging), 1);
  return (
    <Page>
      <Headline eyebrow="Saturday · 14 November 2026" lines={["The ledger,", "read plainly."]} />
      {warn && <div ref={banner} className="mb-10 overflow-hidden border-l-4 border-warning bg-warning-soft px-5 py-4">
        <p className="eyebrow text-warning">Risk vault</p>
        <p className="mt-1 font-display text-2xl">Runway is {runway.toFixed(1)} months — under your {risk.low_cash_threshold_months}-month threshold.</p>
      </div>}
      <section className="grid gap-px bg-border md:grid-cols-4">
        {[["Cash on hand", cash, usd], ["Runway", runway, (n: number) => `${n.toFixed(1)} mo`], ["Open receivables", arap.ar, usd], ["Open payables", arap.ap, usd]].map(([l, v, f], i) => (
          <div key={l as string} data-reveal className="bg-background p-6">
            <p className="eyebrow">{l as string}</p>
            <p className={`mt-3 text-3xl ${i === 1 && warn ? "text-warning" : ""}`}><CountUp value={v as number} format={f as (n: number) => string} delay={0.4 + i * 0.1} /></p>
          </div>))}
      </section>
      <section data-scroll className="mt-16 grid gap-10 md:grid-cols-3">
        <div className="md:col-span-2">
          <div className="flex items-baseline justify-between"><h2 className="text-3xl">Six months of flow</h2><p className="eyebrow"><span className="text-accent">━</span> income &nbsp; ┅ expense &nbsp; ▮ net</p></div>
          <CashChart data={getMonthly(tx)} />
        </div>
        <aside className="border-l pl-6">
          <p className="eyebrow">Projection · December</p>
          <p className="mt-2 text-4xl"><CountUp value={pred.value} format={usd} /></p>
          <p className="mt-2 text-sm text-muted-foreground">{pred.method}.</p>
          <div className="rule my-6" />
          <p className="eyebrow">Overdue AR</p>
          <p className="mt-2 text-2xl text-destructive"><CountUp value={arap.arOverdue} format={usd} /></p>
        </aside>
      </section>
      <section data-scroll className="mt-16 grid gap-10 md:grid-cols-2">
        <div>
          <h2 className="text-3xl">Receivables aging</h2>
          <div className="mt-6 space-y-4">{Object.entries(arap.arAging).map(([k, v]) => (
            <div key={k}><div className="flex justify-between text-sm"><span className="num">{k === "current" ? "Not yet due" : `${k} days`}</span><span className="num">{usd(v)}</span></div>
              <div className="mt-1 h-2 bg-secondary"><AgingBar pct={v / maxAging} /></div></div>))}</div>
        </div>
        <div>
          <h2 className="text-3xl">Market colour</h2>
          <p className="text-sm text-muted-foreground">Qualitative context only — never used in calculations.</p>
          <div className="mt-6 grid grid-cols-2 gap-4">{demoMarket.indicators.map(m => <div key={m.k} className="border-t pt-2"><p className="eyebrow">{m.k}</p><p className="num text-lg">{m.v} <span className="text-xs text-muted-foreground">{m.d}</span></p></div>)}</div>
          <ul className="mt-6 space-y-2 font-display text-lg italic">{demoMarket.headlines.map(h => <li key={h}>“{h}”</li>)}</ul>
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
