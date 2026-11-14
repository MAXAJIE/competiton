import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Page, Headline } from "@/components/Reveal";
import { useStore } from "@/lib/store";
import { sendTestReport } from "@/lib/api";
import { getRunwayMonths } from "@/lib/calc";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Risk vault — CashMonitoring" }, { name: "description", content: "Set your low-cash threshold and report email." }, { property: "og:title", content: "Risk vault — CashMonitoring" }, { property: "og:description", content: "Your own rules for when to worry." }] }),
  component: Settings,
});
function Settings() {
  const { risk, setRisk, tx } = useStore();
  const [r, setR] = useState(risk);
  const runway = getRunwayMonths(tx);
  return (
    <Page>
      <Headline eyebrow="Settings · risk vault" lines={["Your rules", "for when to worry."]} />
      <div className="grid gap-12 md:grid-cols-2">
        <div data-reveal>
          <p className="eyebrow">Warn me when runway falls below</p>
          <p className="mt-2 font-display text-7xl">{r.low_cash_threshold_months}<span className="text-2xl italic text-muted-foreground"> months</span></p>
          <input type="range" min={1} max={12} value={r.low_cash_threshold_months} onChange={e => setR({ ...r, low_cash_threshold_months: +e.target.value })} className="mt-4 w-full accent-[var(--accent)]" />
          <p className="mt-2 text-sm text-muted-foreground">Current runway: <span className="num">{runway.toFixed(1)}</span> months — banner {runway < r.low_cash_threshold_months ? "will show" : "hidden"}.</p>
        </div>
        <div data-reveal className="space-y-6">
          <label className="block"><span className="eyebrow">Overdue AR spike warning (%)</span><input type="number" className="field num" value={r.ar_overdue_spike_pct} onChange={e => setR({ ...r, ar_overdue_spike_pct: +e.target.value })} /></label>
          <label className="block"><span className="eyebrow">Report email</span><input type="email" className="field" value={r.warning_email} onChange={e => setR({ ...r, warning_email: e.target.value })} /></label>
          <label className="flex items-center gap-3"><input type="checkbox" checked={r.enabled} onChange={e => setR({ ...r, enabled: e.target.checked })} /> Warnings enabled</label>
          <div className="flex gap-3">
            <button className="btn btn-solid" onClick={() => { setRisk(r); toast.success("Settings saved"); }}>Save</button>
            <button className="btn" onClick={async () => { const s = await sendTestReport(r.warning_email); toast(`Test report queued to ${s.sentTo}`); }}>Send test report now</button>
          </div>
        </div>
      </div>
    </Page>
  );
}
