import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { BellRing, CircleGauge, Database, KeyRound, Mail, Save, ShieldCheck } from "lucide-react";
import { Page, Headline } from "@/components/Reveal";
import { InteractiveCard } from "@/components/InteractiveCard";
import { AiAccessPanel } from "@/components/AiAccessPanel";
import { DataPrivacyPanel } from "@/components/DataPrivacyPanel";
import { SettingsSkeleton } from "@/components/skeletons/SettingsSkeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSlowPending } from "@/lib/use-slow-pending";
import { useStore } from "@/lib/store";
import { getRiskSettings, saveRiskSettings, sendTestReport } from "@/lib/api";
import { getRunwayMonths } from "@/lib/calc";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Cashflow" },
      {
        name: "description",
        content:
          "Choose your AI key source, then set your runway threshold, overdue receivables warning and report email.",
      },
    ],
  }),
  component: Settings,
});

// Risk thresholds and AI access are two answers to "how should this workspace
// behave", so they share one Settings page. The tabs keep each one short instead
// of stacking every control into a single scroll.
function Settings() {
  const { risk, setRisk, mode, tx, loaded } = useStore();
  const [values, setValues] = useState(risk);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(mode === "user");
  // Distinguishes "nothing to load" (guest) from "not fetched yet" (signed in),
  // so the first paint is a skeleton instead of a flash of default numbers.
  const [hydrated, setHydrated] = useState(mode !== "user");
  const runway = getRunwayMonths(tx);
  // One flag for "settings are not on screen yet": the ledger is still loading,
  // or the signed-in settings request is still in flight. It drives both the
  // skeleton and the action row, so the two can never appear together.
  const pending = !loaded || !hydrated || loading;
  const slowPending = useSlowPending(pending);

  useEffect(() => {
    if (mode !== "user") {
      setValues(risk);
      setLoading(false);
      setHydrated(true);
      return;
    }
    let active = true;
    setLoading(true);
    getRiskSettings()
      .then((settings) => {
        if (active && settings) setValues(settings);
      })
      .catch((error) => {
        if (active)
          toast.error(
            error instanceof Error
              ? `Could not load settings: ${error.message}`
              : "Could not load settings.",
          );
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
        setHydrated(true);
      });
    return () => {
      active = false;
    };
  }, [mode, risk]);

  const update = <K extends keyof typeof values>(key: K, value: (typeof values)[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  const save = async () => {
    setBusy(true);
    try {
      if (mode === "user") setRisk(await saveRiskSettings(values));
      else setRisk(values);
      toast.success(mode === "user" ? "Risk settings saved" : "Saved for this guest session");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save your settings.");
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    if (mode !== "user") {
      toast.error("Sign in to send reports. Guest mode never sends email.");
      return;
    }
    setBusy(true);
    try {
      await saveRiskSettings(values);
      setRisk(values);
      const result = await sendTestReport(values.warning_email);
      toast.success(`Test report sent to ${result.sentTo}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not send the test report.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page>
      <Headline eyebrow="Preferences" lines={["Settings,", "set your way."]} />

      <Tabs defaultValue="risk">
        <TabsList
          aria-label="Settings sections"
          className="mb-6 flex h-auto w-full gap-1 rounded-2xl border border-slate-200 bg-white p-1.5 sm:w-auto"
        >
          <TabsTrigger
            value="risk"
            className="flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm text-slate-600 data-[state=active]:bg-indigo-600 data-[state=active]:text-white data-[state=active]:shadow-none sm:flex-none"
          >
            <CircleGauge className="h-4 w-4" aria-hidden /> Risk &amp; alerts
          </TabsTrigger>
          <TabsTrigger
            value="ai"
            className="flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm text-slate-600 data-[state=active]:bg-indigo-600 data-[state=active]:text-white data-[state=active]:shadow-none sm:flex-none"
          >
            <KeyRound className="h-4 w-4" aria-hidden /> AI access
          </TabsTrigger>
          <TabsTrigger
            value="data"
            className="flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm text-slate-600 data-[state=active]:bg-indigo-600 data-[state=active]:text-white data-[state=active]:shadow-none sm:flex-none"
          >
            <Database className="h-4 w-4" aria-hidden /> Data &amp; privacy
          </TabsTrigger>
        </TabsList>

        <TabsContent value="data" className="mt-0">
          <DataPrivacyPanel />
        </TabsContent>

        <TabsContent value="ai" className="mt-0">
          <InteractiveCard ribbon={false} className="surface p-5 sm:p-7">
            <div className="mb-6 flex items-start gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                <KeyRound className="h-5 w-5" aria-hidden />
              </span>
              <div>
                <p className="eyebrow">AI access</p>
                <h2 className="mt-1 text-2xl">Where should the key come from?</h2>
                <p className="mt-1 lede">
                  Same choice as the setup step: this server's OpenRouter key, or your own.
                  OpenRouter only, for now.
                </p>
              </div>
            </div>
            <AiAccessPanel />
          </InteractiveCard>
        </TabsContent>

        <TabsContent value="risk" className="mt-0">
          <div data-reveal className="mb-6 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-3xl">Risk &amp; alerts</h2>
              <p className="mt-1 lede">Choose when you want a nudge about your cash position.</p>
            </div>
            <span
              className={`hidden items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium sm:inline-flex ${mode === "user" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${mode === "user" ? "bg-emerald-500" : "bg-slate-400"}`}
              />
              {mode === "user" ? "Synced to your account" : "Guest session"}
            </span>
          </div>

          {pending ? (
            slowPending ? (
              <SettingsSkeleton />
            ) : null
          ) : (
            <div className="grid items-start gap-5 lg:grid-cols-12">
              <InteractiveCard ribbon={false} className="surface p-5 sm:p-7 lg:col-span-7">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                    <CircleGauge className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="eyebrow">Runway threshold</p>
                    <h3 className="mt-1 text-2xl">When should we raise a flag?</h3>
                    <p className="mt-1 lede">
                      Your dashboard will highlight runway below this level.
                    </p>
                  </div>
                </div>

                <div className="mt-10 rounded-2xl bg-slate-50 p-5 sm:p-6">
                  <div className="flex flex-wrap items-end justify-between gap-2">
                    <p className="text-sm font-medium text-slate-600">Alert me below</p>
                    <p className="font-display text-5xl text-slate-900">
                      {values.low_cash_threshold_months}
                      <span className="ml-2 text-lg italic text-slate-500">months</span>
                    </p>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={12}
                    step={1}
                    value={values.low_cash_threshold_months}
                    aria-label="Runway warning threshold in months"
                    onChange={(event) => update("low_cash_threshold_months", +event.target.value)}
                    className="mt-6 w-full cursor-pointer accent-indigo-600"
                  />
                  <div className="mt-2 flex justify-between text-[0.65rem] text-slate-400">
                    <span>1 month</span>
                    <span>6 months</span>
                    <span>12 months</span>
                  </div>
                </div>

                <div className="mt-5 flex items-center justify-between gap-4 rounded-xl border border-slate-100 px-4 py-3.5">
                  <div>
                    <p className="text-sm font-medium text-slate-700">Current runway</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Based on your latest recorded activity
                    </p>
                  </div>
                  <span
                    className={`num text-lg font-semibold ${runway !== null && runway < values.low_cash_threshold_months ? "text-amber-700" : "text-slate-800"}`}
                  >
                    {runway === null ? "—" : `${runway.toFixed(1)} mo`}
                  </span>
                </div>
              </InteractiveCard>

              <InteractiveCard ribbon={false} className="surface p-5 sm:p-7 lg:col-span-5">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
                    <BellRing className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="eyebrow">Alerts &amp; reports</p>
                    <h3 className="mt-1 text-2xl">Stay in the loop</h3>
                    <p className="mt-1 lede">Tune overdue invoice warnings and report delivery.</p>
                  </div>
                </div>

                <div className="mt-7 space-y-5">
                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-slate-700">
                      Overdue AR spike threshold
                    </span>
                    <span className="relative block">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="1"
                        className="field num pr-10"
                        value={values.ar_overdue_spike_pct}
                        onChange={(event) => update("ar_overdue_spike_pct", +event.target.value)}
                      />
                      <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm text-slate-400">
                        %
                      </span>
                    </span>
                    <span className="mt-1.5 block text-xs text-muted-foreground">
                      Warn when overdue invoices exceed this share of open receivables.
                    </span>
                  </label>

                  <label className="block">
                    <span className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700">
                      <Mail className="h-4 w-4 text-slate-400" /> Report email
                    </span>
                    <input
                      type="email"
                      className="field"
                      placeholder="you@company.com"
                      value={values.warning_email}
                      onChange={(event) => update("warning_email", event.target.value)}
                    />
                  </label>

                  <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-slate-100 px-4 py-3.5">
                    <span>
                      <span className="block text-sm font-medium text-slate-700">
                        Enable risk warnings
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        Show alerts when thresholds are crossed.
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      checked={values.enabled}
                      onChange={(event) => update("enabled", event.target.checked)}
                      className="h-4 w-4 accent-indigo-600"
                    />
                  </label>

                  {mode !== "user" && (
                    <p className="flex items-start gap-2 rounded-xl bg-slate-50 px-3.5 py-3 text-xs leading-relaxed text-slate-600">
                      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                      Guest settings last for this session only. Sign in to sync settings and send a
                      report.
                    </p>
                  )}
                </div>
              </InteractiveCard>
            </div>
          )}

          {!pending && (
            <div
              data-reveal
              className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <p className="text-xs text-muted-foreground">
                Your thresholds shape alerts; they do not change financial calculations.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <button type="button" className="btn" disabled={busy} onClick={sendTest}>
                  <Mail className="h-4 w-4" /> Send test report
                </button>
                <button type="button" className="btn btn-solid" disabled={busy} onClick={save}>
                  {busy ? (
                    <span
                      className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
                      aria-hidden
                    />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  {busy ? "Saving…" : "Save settings"}
                </button>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>

      <p data-reveal className="mt-8 text-xs text-muted-foreground">
        An AI key is a choice, not a requirement — the calculator and its alerts work without one.
      </p>
    </Page>
  );
}
