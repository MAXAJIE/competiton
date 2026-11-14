import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Page, Headline } from "@/components/Reveal";
import { useStore } from "@/lib/store";
import { getRiskSettings, saveRiskSettings, sendTestReport } from "@/lib/api";
import { getRunwayMonths } from "@/lib/calc";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Risk vault — CashMonitoring" }, { name: "description", content: "Set your low-cash threshold and report email." }, { property: "og:title", content: "Risk vault — CashMonitoring" }, { property: "og:description", content: "Your own rules for when to worry." }] }),
  component: Settings,
});
function Settings() {
  const { risk, setRisk, mode, tx } = useStore();
  const [r, setR] = useState(risk);
  const [busy, setBusy] = useState(false);
  const runway = getRunwayMonths(tx);

  // Signed-in users: hydrate from the backend on load.
  useEffect(() => {
    if (mode !== "user") return;
    getRiskSettings().then(s => { if (s) setR(s); }).catch(e => console.warn("settings load:", e));
  }, [mode]);

  const save = async () => {
    setBusy(true);
    try {
      if (mode === "user") setRisk(await saveRiskSettings(r));
      else setRisk(r); // guest: session state only, nothing persisted (SKILL.md §8)
      toast.success(mode === "user" ? "Settings saved" : "Saved for this session (guest)");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };
  const sendTest = async () => {
    if (mode !== "user") { toast.error("Sign in to send reports — guest mode never sends email."); return; }
    setBusy(true);
    try {
      await saveRiskSettings(r); // report reflects exactly what you see on screen
      const s = await sendTestReport(r.warning_email);
      toast(`Test report queued to ${s.sentTo}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Send failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Page>
      <Headline eyebrow="Settings · risk vault" lines={["Your rules", "for when to worry."]} />
      <div className="grid gap-12 md:grid-cols-2">
        <div data-reveal>
          <p className="eyebrow">Warn me when runway falls below</p>
          <p className="mt-2 font-display text-7xl">{r.low_cash_threshold_months}<span className="text-2xl italic text-muted-foreground"> months</span></p>
          <input type="range" min={1} max={12} value={r.low_cash_threshold_months} onChange={e => setR({ ...r, low_cash_threshold_months: +e.target.value })} className="mt-4 w-full accent-[var(--accent)]" />
          <p className="mt-2 text-sm text-muted-foreground">Current runway: <span className="num">{runway?.toFixed(1) ?? "—"}</span> months — banner {runway !== null && runway < r.low_cash_threshold_months ? "will show" : "hidden"}.</p>
        </div>
        <div data-reveal className="space-y-6">
          <label className="block"><span className="eyebrow">Overdue AR spike warning (%)</span><input type="number" className="field num" value={r.ar_overdue_spike_pct} onChange={e => setR({ ...r, ar_overdue_spike_pct: +e.target.value })} /></label>
          <label className="block"><span className="eyebrow">Report email</span><input type="email" className="field" value={r.warning_email} onChange={e => setR({ ...r, warning_email: e.target.value })} /></label>
          <label className="flex items-center gap-3"><input type="checkbox" checked={r.enabled} onChange={e => setR({ ...r, enabled: e.target.checked })} /> Warnings enabled</label>
          <div className="flex gap-3">
            <button className="btn btn-solid" disabled={busy} onClick={save}>Save</button>
            <button className="btn" disabled={busy} onClick={sendTest}>Send test report now</button>
          </div>
        </div>
      </div>
    </Page>
  );
}
