import { useRef } from "react";
import { gsap, useGSAP } from "@/lib/motion";
import { usd } from "@/lib/calc";
type M = { month: string; income: number; expense: number };
export function CashChart({ data }: { data: M[] }) {
  const ref = useRef<SVGSVGElement>(null);
  const W = 720, H = 260, P = 30;
  // Nothing recorded yet: an empty frame, never an invented line.
  if (data.length < 2) {
    return (
      <div className="mt-6 flex h-[260px] items-center justify-center border border-dashed">
        <p className="text-sm text-muted-foreground">
          {data.length === 0 ? "No monthly flow yet — add entries to see the trend." : "One month recorded — add another to see the trend."}
        </p>
      </div>
    );
  }
  const max = Math.max(...data.map(d => Math.max(d.income, d.expense))) * 1.1 || 1;
  const x = (i: number) => P + (i * (W - 2 * P)) / (data.length - 1);
  const y = (v: number) => H - P - (v / max) * (H - 2 * P);
  const line = (k: "income" | "expense") => data.map((d, i) => `${i ? "L" : "M"}${x(i)},${y(d[k])}`).join(" ");
  useGSAP(() => {
    if (!ref.current) return;
    ref.current.querySelectorAll<SVGPathElement>("[data-draw]").forEach(p => {
      const L = p.getTotalLength(); gsap.fromTo(p, { strokeDasharray: L, strokeDashoffset: L }, { strokeDashoffset: 0, duration: 2, ease: "power2.inOut", scrollTrigger: { trigger: ref.current, start: "top 85%" } });
    });
    gsap.from("[data-dot]", { scale: 0, transformOrigin: "center", stagger: 0.08, delay: 1.2, duration: 0.5, ease: "back.out(3)", scrollTrigger: { trigger: ref.current, start: "top 85%" } });
    gsap.from("[data-bar]", { scaleY: 0, transformOrigin: "bottom", stagger: 0.06, duration: 1, ease: "expo.out", scrollTrigger: { trigger: ref.current, start: "top 85%" } });
  }, { scope: ref });
  return (
    <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="w-full">
      {[0.25, 0.5, 0.75].map(f => <line key={f} x1={P} x2={W - P} y1={y(max * f)} y2={y(max * f)} className="stroke-border" strokeDasharray="2 4" />)}
      {data.map((d, i) => <rect key={d.month} data-bar x={x(i) - 10} width={20} y={y(d.income - d.expense)} height={H - P - y(d.income - d.expense)} className="fill-secondary" />)}
      <path data-draw d={line("expense")} fill="none" className="stroke-muted-foreground" strokeWidth={1.5} strokeDasharray="4 4" />
      <path data-draw d={line("income")} fill="none" className="stroke-accent" strokeWidth={2.5} />
      {data.map((d, i) => <g key={i}><circle data-dot cx={x(i)} cy={y(d.income)} r={4} className="fill-accent" /><title>{usd(d.income)}</title>
        <text x={x(i)} y={H - 8} textAnchor="middle" className="fill-muted-foreground num text-[10px]">{new Date(d.month + "-01").toLocaleString("en-US", { month: "short" })}</text></g>)}
    </svg>
  );
}
