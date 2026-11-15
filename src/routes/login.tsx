import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowRight, LockKeyhole, ShieldCheck, Sparkles } from "lucide-react";
import { Page } from "@/components/Reveal";
import { InteractiveCard } from "@/components/InteractiveCard";
import { WidgetRibbon } from "@/components/WidgetRibbon";
import { useStore } from "@/lib/store";
import { fetchTransactions, signIn, signInWithGoogle } from "@/lib/api";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign in — Cashflow" },
      {
        name: "description",
        content: "Sign in to your private cash-flow workspace or explore in guest mode.",
      },
    ],
  }),
  component: Login,
});

function Login() {
  const { setMode, setTx } = useStore();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const enter = async (authenticate: () => Promise<void>) => {
    setBusy(true);
    try {
      await authenticate();
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
      navigate({ to: "/" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Sign in failed.");
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
          <div className="mb-9 inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700">
            <LockKeyhole className="h-3.5 w-3.5" /> Private finance workspace
          </div>
          <p className="eyebrow">Welcome back</p>
          <h1 className="mt-2 text-5xl leading-[0.95] sm:text-6xl">
            Your business,
            <br />
            <span className="italic text-accent">in clear view.</span>
          </h1>
          <p className="lede mt-4 max-w-md">
            Sign in to see your ledger and the financial signals that matter—kept private to your
            account.
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
              <span className="mb-2 block text-sm font-medium text-slate-700">Email address</span>
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
            <button type="submit" disabled={busy} className="btn btn-solid w-full">
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
            disabled={busy}
            className="btn w-full"
            onClick={() => void enter(signInWithGoogle)}
          >
            <GoogleMark /> Continue with Google
          </button>

          <p className="mt-5 text-center text-xs text-slate-400">
            By signing in, your account data remains private to you.
          </p>
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

          <div className="relative z-10 mt-10 rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur">
            <p className="text-sm font-semibold">Just exploring?</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-300">
              Open a guest workspace with demo data. It stays in this browser session and is never
              saved.
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
