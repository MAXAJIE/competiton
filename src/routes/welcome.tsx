import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowRight, Database, FileText, ShieldCheck, Trash2 } from "lucide-react";
import { Page } from "@/components/Reveal";
import { InteractiveCard } from "@/components/InteractiveCard";
import { useStore } from "@/lib/store";
import { acceptConsent, fetchConsent } from "@/lib/api";
import { getAiSettings } from "@/lib/ai";
import { MIN_AGE, PRIVACY_VERSION, RETENTION, TERMS_VERSION } from "@/lib/legal";

export const Route = createFileRoute("/welcome")({
  head: () => ({
    meta: [
      { title: "Accept the terms — Cashflow" },
      {
        name: "description",
        content:
          "Confirm your age and accept the Terms and Privacy Policy before using the workspace.",
      },
    ],
  }),
  component: Welcome,
});

/**
 * Consent for accounts this app did not create through its own signup form —
 * a Google sign-in, or an account that predates this gate. It is the same two
 * boxes, recorded the same way, and the app is not usable until it is done.
 */
function Welcome() {
  const { mode, loaded } = useStore();
  const navigate = useNavigate();
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!loaded) return;
    if (mode === null) {
      navigate({ to: "/login", replace: true });
      return;
    }
    if (mode === "guest") {
      // Guests have no account and nothing stored on a server: there is nothing
      // to consent to, and bouncing them to /login would be a dead end.
      navigate({ to: "/", replace: true });
      return;
    }
    let cancelled = false;
    fetchConsent()
      .then((state) => {
        if (cancelled) return;
        if (state?.consent) {
          navigate({ to: getAiSettings() ? "/" : "/setup", replace: true });
          return;
        }
        setShow(true);
      })
      .catch(() => setShow(true));
    return () => {
      cancelled = true;
    };
  }, [loaded, mode, navigate]);

  const accept = async () => {
    if (!ageConfirmed || !termsAccepted) {
      toast.error(
        `Both boxes are required: confirm you are ${MIN_AGE}+ and accept the Terms and Privacy Policy.`,
      );
      return;
    }
    setBusy(true);
    try {
      await acceptConsent({
        ageConfirmed,
        termsVersion: TERMS_VERSION,
        privacyVersion: PRIVACY_VERSION,
      });
      toast.success("Thanks — your acceptance is recorded.");
      navigate({ to: getAiSettings() ? "/" : "/setup", replace: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not record your acceptance.");
    } finally {
      setBusy(false);
    }
  };

  if (!show) return null;

  return (
    <Page>
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 flex items-center gap-2">
          <span className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800">
            One more step · 18+
          </span>
          <span className="inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700">
            Research &amp; educational use only
          </span>
        </div>

        <h1 className="text-4xl leading-tight sm:text-5xl">Before you start.</h1>
        <p className="lede mt-3">
          This workspace needs the same two confirmations as a new account. They take a moment and
          are recorded against your account with today&apos;s date and the document versions.
        </p>

        <InteractiveCard ribbon={false} className="surface mt-6 p-5 sm:p-7">
          <ul className="space-y-4 text-sm text-slate-600">
            <li className="flex gap-3">
              <Database className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" aria-hidden />
              <span>
                We store your email, the ledger you enter, the scans you confirm and your alert
                settings — nothing else. Scans are deleted after {RETENTION.documentsDays} days,
                transactions after {RETENTION.transactionsDays}.
              </span>
            </li>
            <li className="flex gap-3">
              <Trash2 className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" aria-hidden />
              <span>
                You can erase everything yourself at any time in Settings → Data &amp; privacy. No
                email, no waiting period.
              </span>
            </li>
            <li className="flex gap-3">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" aria-hidden />
              <span>
                Your data is isolated per account by row level security, and an AI key you supply is
                kept in your browser rather than our database.
              </span>
            </li>
          </ul>

          <div className="mt-6 space-y-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
            <label className="flex cursor-pointer items-start gap-3 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={ageConfirmed}
                onChange={(event) => setAgeConfirmed(event.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-indigo-600"
              />
              <span>
                I confirm that I am <strong>{MIN_AGE} or older</strong>.
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={termsAccepted}
                onChange={(event) => setTermsAccepted(event.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-indigo-600"
              />
              <span>
                I have read and accept the{" "}
                <Link
                  to="/terms"
                  target="_blank"
                  className="font-medium text-indigo-600 hover:underline"
                >
                  Terms of Use
                </Link>{" "}
                (v{TERMS_VERSION}) and{" "}
                <Link
                  to="/privacy"
                  target="_blank"
                  className="font-medium text-indigo-600 hover:underline"
                >
                  Privacy Policy
                </Link>{" "}
                (v{PRIVACY_VERSION}), including that this service is for research and educational
                use only and is not financial advice.
              </span>
            </label>
          </div>

          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <FileText className="h-3.5 w-3.5" aria-hidden />
              Versions {TERMS_VERSION} / {PRIVACY_VERSION}
            </p>
            <button
              type="button"
              className="btn btn-solid"
              disabled={busy || !ageConfirmed || !termsAccepted}
              onClick={() => void accept()}
            >
              {busy ? (
                <span
                  className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
                  aria-hidden
                />
              ) : null}
              {busy ? "Recording…" : "Accept and continue"}
              {!busy && <ArrowRight className="h-4 w-4" />}
            </button>
          </div>
        </InteractiveCard>
      </div>
    </Page>
  );
}
