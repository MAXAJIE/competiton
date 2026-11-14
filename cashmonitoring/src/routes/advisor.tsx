import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { Page, Headline } from "@/components/Reveal";
import { askAdvisor } from "@/lib/api";
import { useStore } from "@/lib/store";
import type { AdvisorReply } from "@/lib/types";
import { gsap, useGSAP } from "@/lib/motion";

export const Route = createFileRoute("/advisor")({
  head: () => ({ meta: [{ title: "Advisor — CashMonitoring" }, { name: "description", content: "Ask questions answered only from your real numbers." }, { property: "og:title", content: "CashMonitoring Advisor" }, { property: "og:description", content: "An advisor that never guesses a number." }] }),
  component: Advisor,
});
const prompts = ["Analyze my cash flow", "Predict next month's revenue", "Summarize AR/AP", "Will interest rates fall?"];
type Msg = { q: string; a?: AdvisorReply };
function Advisor() {
  const { tx } = useStore();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const list = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    const last = list.current?.lastElementChild; if (!last) return;
    gsap.from(last.querySelectorAll("[data-m]"), { y: 24, opacity: 0, stagger: 0.12, duration: 0.7, ease: "power3.out" });
  }, { dependencies: [msgs], scope: list });
  const ask = async (text: string) => {
    if (!text.trim()) return; setQ(""); setMsgs(m => [...m, { q: text }]);
    const a = await askAdvisor(text, tx); setMsgs(m => m.map((x, i) => i === m.length - 1 ? { ...x, a } : x));
  };
  return (
    <Page>
      <Headline eyebrow="Advisor · tool-calling only" lines={["Ask anything.", "It won't guess."]} />
      <div className="flex flex-wrap gap-2" data-reveal>{prompts.map(p => <button key={p} onClick={() => ask(p)} className="btn">{p}</button>)}</div>
      <div ref={list} className="mt-10 space-y-10">
        {msgs.map((m, i) => (
          <article key={i} className="grid gap-4 md:grid-cols-[1fr_2fr]">
            <p data-m className="font-display text-2xl italic">“{m.q}”</p>
            <div data-m className="border-l pl-6">
              {!m.a ? <p className="eyebrow animate-pulse">Calling tools…</p> : <>
                <p className="eyebrow">{m.a.tool ? `tool · ${m.a.tool}` : "no matching tool"}</p>
                <p className="mt-2">{m.a.text}</p>
                {m.a.figures && <div className="mt-4 flex flex-wrap gap-8">{m.a.figures.map(f => <div key={f.label}><p className="eyebrow">{f.label}</p><p className="num text-2xl">{f.value}</p></div>)}</div>}
              </>}
            </div>
          </article>))}
      </div>
      <form data-reveal onSubmit={e => { e.preventDefault(); ask(q); }} className="mt-12 flex gap-4 border-t pt-6">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Type a question…" className="field font-display text-2xl" />
        <button className="btn btn-solid">Ask</button>
      </form>
    </Page>
  );
}
