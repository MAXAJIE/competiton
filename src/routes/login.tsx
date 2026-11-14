import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Page, Headline } from "@/components/Reveal";
import { useStore } from "@/lib/store";
import { fetchTransactions, signIn, signInWithGoogle } from "@/lib/api";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Sign in — CashMonitoring" }, { name: "description", content: "Sign in or explore as a guest with demo data." }, { property: "og:title", content: "Sign in — CashMonitoring" }, { property: "og:description", content: "Sign in or try guest mode." }] }),
  component: Login,
});
function Login() {
  const { setMode, setTx } = useStore();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const enter = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      setMode("user");
      try { const rows = await fetchTransactions(); if (rows.length) setTx(rows); } catch { /* dashboard still renders local state */ }
      nav({ to: "/" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Page>
      <Headline eyebrow="Access" lines={["Private by", "default."]} />
      <div className="grid gap-12 md:grid-cols-2">
        <form data-reveal className="space-y-6" onSubmit={e => { e.preventDefault(); enter(async () => { await signIn(email, pw); }); }}>
          <label className="block"><span className="eyebrow">Email</span><input required type="email" className="field" value={email} onChange={e => setEmail(e.target.value)} /></label>
          <label className="block"><span className="eyebrow">Password</span><input required type="password" className="field" value={pw} onChange={e => setPw(e.target.value)} /></label>
          <button disabled={busy} className="btn btn-solid">{busy ? "Signing in…" : "Sign in →"}</button>
          <div className="flex items-center gap-4 text-muted-foreground"><span className="h-px flex-1 bg-border" /><span className="eyebrow">or</span><span className="h-px flex-1 bg-border" /></div>
          <button type="button" disabled={busy} className="btn w-full" onClick={() => enter(() => signInWithGoogle())}>
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.4a5.5 5.5 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.6-5.2 3.6-8.8z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z"/><path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8l4-3.1z"/><path fill="#EA4335" d="M12 4.7c1.8 0 3.3.6 4.6 1.8L20 3.2A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-5 6.7-5z"/></svg>
            Continue with Google
          </button>
        </form>
        <div data-reveal className="border-l pl-8">
          <h2 className="text-3xl">Just looking?</h2>
          <p className="mt-2 text-muted-foreground">Guest mode loads demo data in this browser tab only. Nothing is ever saved.</p>
          <button className="btn mt-6" onClick={() => { setMode("guest"); nav({ to: "/" }); }}>Continue as guest</button>
        </div>
      </div>
    </Page>
  );
}
