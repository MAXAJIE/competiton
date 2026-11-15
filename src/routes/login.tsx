import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import {
  ArrowRight,
  CheckCircle2,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  UserPlus,
} from "lucide-react";
import { Page } from "@/components/Reveal";
import { InteractiveCard } from "@/components/InteractiveCard";
import { WidgetRibbon } from "@/components/WidgetRibbon";
import { useStore } from "@/lib/store";
import {
  createAccount,
  fetchConsent,
  fetchTransactions,
  signIn,
  signInWithGoogle,
} from "@/lib/api";
import { getAiSettings } from "@/lib/ai";
import { AUTH_CONFIGURED } from "@/lib/supabase";
import { MIN_AGE, PRIVACY, PRIVACY_VERSION, TERMS, TERMS_VERSION } from "@/lib/legal";
import {
  confirmProblem as confirmIssue,
  passwordProblem as passwordIssue,
  registrationProblem,
} from "@/lib/registration";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign in — Cashflow" },
      {
        name: "description",
        content:
          "Sign in to your private cash-flow workspace, create an account (18+), or explore in guest mode. Research and educational use only.",
      },
    ],
  }),
  component: Login,
});

/** The one place both legal documents are named, so the copy cannot drift. */
function LegalLinks({ className = "" }: { className?: string }) {
  return (
    <span className={className}>
      <Link
        to="/terms"
        target="_blank"
        className="font-medium text-indigo-600 underline-offset-2 hover:underline"
      >
        Terms of Use
      </Link>{" "}
      and{" "}
      <Link
        to="/privacy"
        target="_blank"
        className="font-medium text-indigo-600 underline-offset-2 hover:underline"
      >
        Privacy Policy
      </Link>
    </span>
  );
}

function Login() {
  const { setMode, setTx } = useStore();
  const navigate = useNavigate();
  const [tab, setTab] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [awaitingEmail, setAwaitingEmail] = useState(false);

  const afterAuth = async () => {
    setMode("user");
    try {
      const rows = await fetchTransactions();
      setTx(rows);
    } catch (error) {
      setTx([]);
      toast.error(
        error instanceof Error
          ? `Signed in, but could not load your ledger: ${error.message}`
          : "Signed in, but could not load your ledger.",
      );
    }
    // Accounts that signed in through Google never saw a consent form, so ask
    // before anything else. Unknown (backend down) does not block the app.
    const consent = await fetchConsent();
    if (consent && !consent.consent) {
      navigate({ to: "/welcome" });
      return;
    }
    // A first sign-in lands on the AI setup step; a returning one goes straight
    // to the dashboard because the choice is already stored in this browser.
    navigate({ to: getAiSettings() ? "/" : "/setup" });
  };

  const enter = async (authenticate: () => Promise<void>) => {
    setBusy(true);
    try {
      await authenticate();
      await afterAuth();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Sign in failed.");
    } finally {
      setBusy(false);
    }
  };

  // Rules live in lib/registration.ts so the form, the copy and the tests cannot
  // disagree about what "valid" means — the backend enforces them again.
  const passwordProblem = passwordIssue(password);
  const confirmProblem = confirmIssue(password, confirm);
  const canRegister =
    registrationProblem({ email, password, confirm, ageConfirmed, termsAccepted }) === null &&
    !busy;

  const register = async () => {
    const problem = registrationProblem({ email, password, confirm, ageConfirmed, termsAccepted });
    if (problem) {
      toast.error(problem);
      return;
    }
    setBusy(true);
    try {
      const result = await createAccount({
        email: email.trim(),
        password,
        ageConfirmed,
        termsAccepted,
        termsVersion: TERMS_VERSION,
        privacyVersion: PRIVACY_VERSION,
      });
      if (result.needsConfirmation) {
        setAwaitingEmail(true);
        toast.success("Account created — check your email to confirm it.");
        return;
      }
      toast.success("Account created. Welcome.");
      await afterAuth();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create the account.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page>
      <InteractiveCard
        tilt={1.2}
        data-reveal
        className="mx-auto grid max-w-5xl overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-[0_24px_70px_rgba(27,43,69,0.10)] lg:grid-cols-[1.05fr_.95fr]"
      >
        <section className="p-6 sm:p-10 lg:p-12">
          {!AUTH_CONFIGURED && (
            <div className="mb-6 flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3.5 text-xs leading-relaxed text-amber-900">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
              <p>
                <span className="font-semibold">
                  This deployment was built without Supabase credentials, so accounts cannot work.
                </span>{" "}
                Sign-in and sign-up are disabled — the guest workspace below is fully usable. To
                enable accounts, set{" "}
                <code className="rounded bg-amber-100 px-1">VITE_SUPABASE_URL</code> and{" "}
                <code className="rounded bg-amber-100 px-1">VITE_SUPABASE_ANON_KEY</code> in the
                deploy platform&apos;s build settings and redeploy.
              </p>
            </div>
          )}

          <div className="mb-8 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700">
              <LockKeyhole className="h-3.5 w-3.5" /> Private finance workspace
            </span>
            <span className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800">
              Research &amp; educational use only
            </span>
          </div>

          <div
            role="tablist"
            aria-label="Sign in or create an account"
            className="mb-6 flex gap-1 rounded-2xl border border-slate-200 bg-slate-50 p-1.5"
          >
            {(
              [
                ["signin", "Sign in"],
                ["signup", "Create account"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                onClick={() => setTab(value)}
                className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${
                  tab === value
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {awaitingEmail ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
              <p className="flex items-center gap-2 text-sm font-semibold text-emerald-900">
                <CheckCircle2 className="h-4 w-4" aria-hidden /> Confirm your email
              </p>
              <p className="mt-1.5 text-sm leading-relaxed text-emerald-900/80">
                We sent a confirmation link to <span className="font-medium">{email}</span>. Open
                it, then sign in here. Nothing is stored for this account until you do.
              </p>
              <button
                type="button"
                className="btn mt-4"
                onClick={() => {
                  setAwaitingEmail(false);
                  setTab("signin");
                }}
              >
                Back to sign in
              </button>
            </div>
          ) : tab === "signin" ? (
            <>
              <p className="eyebrow">Welcome back</p>
              <h1 className="mt-2 text-5xl leading-[0.95] sm:text-6xl">
                Your business,
                <br />
                <span className="italic text-accent">in clear view.</span>
              </h1>
              <p className="lede mt-4 max-w-md">
                Sign in to see your ledger and the financial signals that matter—kept private to
                your account.
              </p>

              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void enter(async () => {
                    await signIn(email, password);
                  });
                }}
                className="mt-8 space-y-5"
              >
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">
                    Email address
                  </span>
                  <input
                    required
                    autoComplete="email"
                    type="email"
                    className="field"
                    placeholder="you@company.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">Password</span>
                  <input
                    required
                    autoComplete="current-password"
                    type="password"
                    className="field"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </label>
                <button
                  type="submit"
                  disabled={busy || !AUTH_CONFIGURED}
                  className="btn btn-solid w-full"
                >
                  {busy ? (
                    <span
                      className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
                      aria-hidden
                    />
                  ) : (
                    <LockKeyhole className="h-4 w-4" />
                  )}
                  {busy ? "Signing you in…" : "Sign in securely"}
                  {!busy && <ArrowRight className="ml-auto h-4 w-4" />}
                </button>
              </form>

              <div className="my-5 flex items-center gap-3 text-xs text-slate-400">
                <span className="h-px flex-1 bg-slate-200" />
                <span>or continue with</span>
                <span className="h-px flex-1 bg-slate-200" />
              </div>
              <button
                type="button"
                disabled={busy || !AUTH_CONFIGURED}
                className="btn w-full"
                onClick={() => void enter(signInWithGoogle)}
              >
                <GoogleMark /> Continue with Google
              </button>

              <p className="mt-5 text-center text-xs leading-relaxed text-slate-400">
                By signing in you accept the <LegalLinks />. Accounts are for adults ({MIN_AGE}+)
                and the service is for research and educational use only — not financial advice.
              </p>
            </>
          ) : (
            <>
              <p className="eyebrow">Create your account</p>
              <h1 className="mt-2 text-4xl leading-[1.02] sm:text-5xl">
                Start with a
                <br />
                <span className="italic text-accent">clean ledger.</span>
              </h1>
              <p className="lede mt-4 max-w-md">
                One account, one ledger, nothing shared. You can delete everything again at any time
                from Settings.
              </p>

              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void register();
                }}
                className="mt-7 space-y-4"
              >
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">
                    Email address
                  </span>
                  <input
                    required
                    type="email"
                    autoComplete="email"
                    className="field"
                    placeholder="you@company.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">Password</span>
                  <input
                    required
                    type="password"
                    autoComplete="new-password"
                    className="field"
                    placeholder="At least 8 characters, letters and a digit"
                    aria-describedby="password-help"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  <span
                    id="password-help"
                    className={`mt-1.5 block text-xs ${passwordProblem ? "text-amber-700" : "text-muted-foreground"}`}
                  >
                    {passwordProblem || "At least 8 characters, including a letter and a digit."}
                  </span>
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">
                    Confirm password
                  </span>
                  <input
                    required
                    type="password"
                    autoComplete="new-password"
                    className="field"
                    value={confirm}
                    onChange={(event) => setConfirm(event.target.value)}
                  />
                  {confirmProblem && (
                    <span className="mt-1.5 block text-xs text-amber-700">{confirmProblem}</span>
                  )}
                </label>

                <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                  <label className="flex cursor-pointer items-start gap-3 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      required
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
                      required
                      checked={termsAccepted}
                      onChange={(event) => setTermsAccepted(event.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-indigo-600"
                    />
                    <span>
                      I have read and accept the <LegalLinks /> (version {TERMS_VERSION}), including
                      that this service is for <strong>research and educational use only</strong>{" "}
                      and is not financial advice.
                    </span>
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={!canRegister || !AUTH_CONFIGURED}
                  className="btn btn-solid w-full"
                >
                  {busy ? (
                    <span
                      className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
                      aria-hidden
                    />
                  ) : (
                    <UserPlus className="h-4 w-4" />
                  )}
                  {busy ? "Creating your account…" : "Create account"}
                </button>

                <p className="text-center text-xs leading-relaxed text-slate-400">
                  Both boxes are required. Your acceptance, the document versions and the date are
                  recorded with the account; the password is hashed by Supabase Auth and never seen
                  by this app.
                </p>
              </form>
            </>
          )}
        </section>

        <aside className="widget-stripe-panel relative flex min-h-[360px] flex-col justify-between overflow-hidden bg-[#172641] p-6 text-white sm:p-10 lg:min-h-full lg:p-12">
          <WidgetRibbon panel />
          <div
            aria-hidden
            className="absolute -right-20 -top-20 z-10 h-80 w-80 rounded-full border border-white/10"
          />
          <div
            aria-hidden
            className="absolute -right-4 top-12 z-10 h-52 w-52 rounded-full border border-white/10"
          />
          <div className="relative z-10">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-500 text-white shadow-lg shadow-indigo-950/30">
              <Sparkles className="h-6 w-6" />
            </span>
            <p className="eyebrow mt-8 text-slate-300">A calmer way to manage cash</p>
            <h2 className="mt-2 max-w-sm text-4xl leading-tight">
              Clarity for your next decision.
            </h2>
            <div className="mt-7 space-y-4">
              {[
                "See your runway at a glance",
                "Know what’s due and when",
                "Ask an advisor grounded in your numbers",
              ].map((item, index) => (
                <p
                  key={item}
                  className="list-item-enter flex items-center gap-3 text-sm text-slate-300"
                  style={{ animationDelay: `${index * 70}ms` }}
                >
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-300">
                    <ShieldCheck className="h-3.5 w-3.5" />
                  </span>
                  {item}
                </p>
              ))}
            </div>
          </div>

          <div className="relative z-10 mt-10 space-y-4">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur">
              <p className="text-sm font-semibold">Just exploring?</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-300">
                Open a guest workspace with demo data. It stays in this browser session and is never
                saved or sent anywhere.
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setMode("guest");
                  setTx([]);
                  navigate({ to: "/" });
                }}
                className="motion-cta mt-4 inline-flex min-h-10 items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-[#172641] transition-colors hover:bg-indigo-50 disabled:opacity-50"
              >
                Explore as guest <ArrowRight className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs leading-relaxed text-slate-400">
              Read the <LegalLinks className="[&_a]:text-indigo-300" />. Version {TERMS.version} ·{" "}
              {PRIVACY.version}, effective {TERMS.effective}.
            </p>
          </div>
        </aside>
      </InteractiveCard>
    </Page>
  );
}

function GoogleMark() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4">
      <path
        fill="#4285F4"
        d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.4a5.5 5.5 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.6-5.2 3.6-8.8z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z"
      />
      <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8l4-3.1z" />
      <path
        fill="#EA4335"
        d="M12 4.7c1.8 0 3.3.6 4.6 1.8L20 3.2A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-5 6.7-5z"
      />
    </svg>
  );
}
