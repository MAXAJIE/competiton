import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Page, Headline } from "@/components/Reveal";
import { useStore } from "@/lib/store";
import { signIn } from "@/lib/api";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Sign in — CashMonitoring" }, { name: "description", content: "Sign in or explore as a guest with demo data." }, { property: "og:title", content: "Sign in — CashMonitoring" }, { property: "og:description", content: "Sign in or try guest mode." }] }),
  component: Login,
});
function Login() {
  const { setMode } = useStore(); const nav = useNavigate();
  const [email, setEmail] = useState(""); const [pw, setPw] = useState("");
  return (
    <Page>
      <Headline eyebrow="Access" lines={["Private by", "default."]} />
      <div className="grid gap-12 md:grid-cols-2">
        <form data-reveal className="space-y-6" onSubmit={async e => { e.preventDefault(); await signIn(email, pw); setMode("user"); nav({ to: "/" }); }}>
          <label className="block"><span className="eyebrow">Email</span><input required type="email" className="field" value={email} onChange={e => setEmail(e.target.value)} /></label>
          <label className="block"><span className="eyebrow">Password</span><input required type="password" className="field" value={pw} onChange={e => setPw(e.target.value)} /></label>
          <button className="btn btn-solid">Sign in →</button>
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
