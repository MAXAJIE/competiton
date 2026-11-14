// Floating advisor widget — a robot button pinned bottom-right that never
// disappears, expanding into a small chat panel. Every answer still comes from
// the backend's tool-calling advisor (POST /api/advisor): the widget only sends
// the question and renders the tool name + figures it gets back, so no number
// is ever produced in the browser.
import { useEffect, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { InteractiveCard } from "@/components/InteractiveCard";
import { useStore } from "@/lib/store";
import { askAdvisor } from "@/lib/api";
import type { AdvisorReply } from "@/lib/types";

type Msg = {
  role: "user" | "bot";
  text: string;
  tool?: string | undefined;
  figures?: AdvisorReply["figures"] | undefined;
};

const SUGGESTIONS = ["Analyze my cash flow", "Summarize AR/AP", "Predict next month's revenue"];

function RobotIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="4" y="8" width="16" height="11" rx="3" />
      <path d="M12 4.5V8" />
      <circle cx="12" cy="3.5" r="1.4" />
      <circle cx="9" cy="13" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="13" r="1.1" fill="currentColor" stroke="none" />
      <path d="M9.5 16.2h5" />
      <path d="M2.5 12v3M21.5 12v3" />
    </svg>
  );
}

export function AdvisorWidget() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { tx } = useStore();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([
    {
      role: "bot",
      text: "I'm your cash advisor. I answer only from your recorded numbers, and I'll say so when I can't.",
    },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, open, sending]);
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || sending) return;
    setInput("");
    setMsgs((m) => [...m, { role: "user", text: q }]);
    setSending(true);
    try {
      const a = await askAdvisor(q, tx);
      setMsgs((m) => [...m, { role: "bot", text: a.text, tool: a.tool, figures: a.figures }]);
    } catch (e) {
      setMsgs((m) => [
        ...m,
        {
          role: "bot",
          text: e instanceof Error ? e.message : "The advisor is unavailable right now.",
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      {/* Launcher: always visible, bottom-right, above page content */}
      <InteractiveCard
        ribbon={pathname !== "/entry" && pathname !== "/settings"}
        tilt={6}
        data-entrance="launcher"
        className="fixed bottom-5 right-5 z-[60] h-14 w-14 rounded-2xl sm:bottom-7 sm:right-7"
      >
        <button
          type="button"
          aria-label={open ? "Close cash advisor" : "Open cash advisor"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="advisor-launcher flex h-full w-full items-center justify-center rounded-2xl border border-[#172641] bg-[#172641] text-white shadow-[0_12px_30px_rgba(23,38,65,0.28)] transition-all hover:-translate-y-0.5 hover:border-indigo-500 hover:bg-indigo-600 active:scale-95"
        >
          {open ? (
            <span className="text-2xl leading-none">×</span>
          ) : (
            <RobotIcon className="h-7 w-7" />
          )}
          {!open && (
            <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-background bg-accent" />
          )}
        </button>
      </InteractiveCard>

      {open && (
        <section
          role="dialog"
          aria-label="Cash advisor chat"
          className="fixed bottom-24 right-4 z-[60] flex h-[min(600px,76vh)] w-[min(400px,calc(100vw-2rem))] animate-in fade-in zoom-in-95 slide-in-from-bottom-3 flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_24px_70px_rgba(19,35,61,0.24)] duration-200 sm:bottom-28 sm:right-7"
        >
          <header className="flex items-center gap-3 border-b border-slate-100 bg-white px-4 py-3.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              <RobotIcon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="font-semibold leading-tight text-slate-800">Cash advisor</p>
              <p className="mt-1 text-[0.65rem] font-medium text-slate-500">
                Grounded in your recorded numbers
              </p>
            </div>
            <span
              className="ml-auto h-2 w-2 rounded-full bg-emerald-500"
              aria-label="Advisor ready"
            />
          </header>

          <div className="flex-1 space-y-4 overflow-y-auto bg-slate-50/70 px-4 py-4">
            {msgs.map((m, i) => (
              <div
                key={i}
                className={`message-enter flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                style={{ animationDelay: `${Math.min(i, 6) * 55}ms` }}
              >
                <div
                  className={`max-w-[85%] px-3 py-2 text-sm ${
                    m.role === "user"
                      ? "rounded-2xl rounded-br-md bg-[#172641] text-white"
                      : "rounded-2xl rounded-bl-md border border-slate-200 bg-white text-slate-700 shadow-sm"
                  }`}
                >
                  {m.role === "bot" && m.tool && (
                    <p className="eyebrow mb-1 text-accent">tool · {m.tool}</p>
                  )}
                  <p className="whitespace-pre-wrap">{m.text}</p>
                  {m.figures && m.figures.length > 0 && (
                    <div className="mt-2 space-y-1 border-t pt-2">
                      {m.figures.map((f) => (
                        <div key={f.label} className="flex items-baseline justify-between gap-3">
                          <span className="eyebrow">{f.label}</span>
                          <span className="num text-sm">{f.value}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {sending && (
              <div
                className="flex items-center gap-2 text-muted-foreground"
                role="status"
                aria-label="Advisor is responding"
              >
                <span className="h-2 w-2 animate-bounce rounded-full bg-accent [animation-delay:-.2s]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-accent [animation-delay:-.1s]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-accent" />
                <span className="ml-1 text-xs font-medium">Checking your numbers…</span>
              </div>
            )}
            <div ref={endRef} />
          </div>

          {msgs.length <= 1 && (
            <div className="flex flex-wrap gap-2 px-4 pb-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="suggestion-chip rounded-full border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700"
                  onClick={() => send(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          <form
            className="flex items-center gap-2 border-t border-slate-100 bg-white p-3"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={tx.length ? "Ask about your cash…" : "Add an entry first…"}
              className="field rounded-xl border-slate-200 bg-slate-50 text-sm"
              aria-label="Message the cash advisor"
            />
            <button
              type="submit"
              className="btn btn-solid h-11 min-h-0 px-3 py-2"
              disabled={sending || !input.trim()}
              aria-label="Send"
            >
              ↑
            </button>
          </form>
        </section>
      )}
    </>
  );
}
