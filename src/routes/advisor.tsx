import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Bot,
  FileText,
  MessageCircle,
  Send,
  Sparkles,
  WalletCards,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Page, Headline } from "@/components/Reveal";
import { InteractiveCard } from "@/components/InteractiveCard";
import { askAdvisor } from "@/lib/api";
import { useStore } from "@/lib/store";
import type { AdvisorReply } from "@/lib/types";

export const Route = createFileRoute("/advisor")({
  head: () => ({
    meta: [
      { title: "AI advisor — Cashflow" },
      { name: "description", content: "Ask questions answered from your recorded financial data." },
    ],
  }),
  component: Advisor,
});

const prompts = [
  "Analyze my cash flow",
  "Predict next month's revenue",
  "Summarize AR and AP",
  "Prepare a financial statement",
];
const advisorTools: { icon: LucideIcon; label: string }[] = [
  { icon: WalletCards, label: "Cash flow & runway" },
  { icon: MessageCircle, label: "AR/AP summary & aging" },
  { icon: FileText, label: "Financial statement" },
];
type Message = { id: number; question: string; answer?: AdvisorReply };

function Advisor() {
  const { tx } = useStore();
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  const ask = async (text: string) => {
    const prompt = text.trim();
    if (!prompt || sending) return;
    const id = Date.now();
    setQuestion("");
    setMessages((current) => [...current, { id, question: prompt }]);
    setSending(true);
    try {
      const answer = await askAdvisor(prompt, tx);
      setMessages((current) =>
        current.map((message) => (message.id === id ? { ...message, answer } : message)),
      );
    } catch (error) {
      const answer: AdvisorReply = {
        text: error instanceof Error ? error.message : "The advisor is unavailable right now.",
      };
      setMessages((current) =>
        current.map((message) => (message.id === id ? { ...message, answer } : message)),
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <Page>
      <Headline
        eyebrow="Your AI finance partner"
        lines={["Good questions.", "Grounded answers."]}
      />

      <div className="grid items-start gap-5 xl:grid-cols-12">
        <InteractiveCard
          tilt={0}
          role="region"
          aria-label="Cashflow advisor"
          className="surface min-w-0 overflow-hidden xl:col-span-8"
        >
          <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4 sm:px-7">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              <Bot className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-semibold text-slate-800">Cashflow advisor</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Figures come from your ledger tools
              </p>
            </div>
            <span className="ml-auto hidden rounded-full bg-slate-100 px-2.5 py-1 text-[0.65rem] font-semibold uppercase tracking-wide text-slate-500 sm:inline-flex">
              No invented numbers
            </span>
          </div>

          <div
            ref={listRef}
            className="max-h-[min(60vh,620px)] min-h-[300px] space-y-5 overflow-y-auto bg-slate-50/60 px-4 py-5 sm:px-7 sm:py-7"
            aria-live="polite"
          >
            {messages.length === 0 && (
              <div className="flex min-h-[250px] flex-col items-center justify-center text-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-indigo-600 shadow-sm">
                  <Sparkles className="h-6 w-6" />
                </span>
                <h2 className="mt-4 text-3xl">What would you like to understand?</h2>
                <p className="mt-1 max-w-md lede">
                  Ask about cash flow, runway, receivables, payables or a revenue projection.
                </p>
                {tx.length === 0 && (
                  <p className="mt-3 text-xs text-slate-500">
                    There are no transactions in this ledger yet; the advisor will say when there is
                    nothing to calculate.
                  </p>
                )}
              </div>
            )}
            {messages.map((message, index) => (
              <article
                key={message.id}
                className="message-enter space-y-3"
                style={{ animationDelay: `${index * 55}ms` }}
              >
                <div className="ml-auto max-w-[88%] rounded-2xl rounded-br-md bg-[#172641] px-4 py-3 text-sm text-white sm:max-w-[76%]">
                  <p>{message.question}</p>
                </div>
                <div className="flex max-w-[92%] items-start gap-2.5 sm:max-w-[84%]">
                  <span className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white text-indigo-600 shadow-sm">
                    <Bot className="h-4 w-4" />
                  </span>
                  <div
                    className={`min-w-0 flex-1 rounded-2xl rounded-tl-md border border-slate-200 bg-white px-4 py-3 ${message.answer ? "message-enter" : ""}`}
                  >
                    {!message.answer ? (
                      <div className="flex items-center gap-2 text-sm text-slate-500" role="status">
                        <span className="flex gap-1">
                          <i className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-500 [animation-delay:-.2s]" />
                          <i className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-500 [animation-delay:-.1s]" />
                          <i className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-500" />
                        </span>
                        Consulting your financial tools…
                      </div>
                    ) : (
                      <>
                        <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                          {message.answer.text}
                        </p>
                        {message.answer.tool && (
                          <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-2.5 py-1 text-[0.65rem] font-semibold text-indigo-700">
                            <Sparkles className="h-3 w-3" />
                            {message.answer.tool.replaceAll("_", " ")}
                          </p>
                        )}
                        {message.answer.figures && message.answer.figures.length > 0 && (
                          <div className="mt-3 grid gap-2 border-t border-slate-100 pt-3 sm:grid-cols-2">
                            {message.answer.figures.map((figure) => (
                              <div
                                key={figure.label}
                                className="rounded-xl bg-slate-50 px-3 py-2.5"
                              >
                                <p className="eyebrow">{figure.label}</p>
                                <p className="num mt-1 text-sm font-semibold text-slate-900">
                                  {figure.value}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>

          {messages.length === 0 && (
            <div className="flex flex-wrap gap-2 border-t border-slate-100 px-4 py-4 sm:px-7">
              {prompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  disabled={sending}
                  onClick={() => ask(prompt)}
                  className="suggestion-chip rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 disabled:opacity-50"
                >
                  {prompt}
                </button>
              ))}
            </div>
          )}

          <form
            onSubmit={(event) => {
              event.preventDefault();
              ask(question);
            }}
            className="flex items-center gap-2 border-t border-slate-100 bg-white p-3 sm:gap-3 sm:p-4"
          >
            <input
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Ask about your cash position…"
              aria-label="Ask the cashflow advisor"
              className="field min-w-0 flex-1 border-transparent bg-slate-50"
            />
            <button
              type="submit"
              className="btn btn-solid shrink-0 px-3 sm:px-4"
              disabled={sending || !question.trim()}
              aria-label="Send question"
            >
              <Send className="h-4 w-4" />
              <span className="hidden sm:inline">Ask</span>
            </button>
          </form>
        </InteractiveCard>

        <aside className="space-y-5 xl:col-span-4">
          <InteractiveCard tilt={0} className="rounded-3xl bg-[#172641] p-5 text-white sm:p-6">
            <p className="eyebrow text-slate-300">Built for clarity</p>
            <h2 className="mt-2 text-3xl">Every figure has a source.</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-300">
              The advisor calls named calculation tools and shows the figures they return. When a
              question falls outside those tools, it won’t guess.
            </p>
            <div className="mt-5 space-y-3 border-t border-white/15 pt-4">
              {advisorTools.map(({ icon: Icon, label }, index) => (
                <div
                  key={label}
                  className="list-item-enter flex items-center gap-2.5 text-sm text-slate-200"
                  style={{ animationDelay: `${index * 55}ms` }}
                >
                  <Icon className="h-4 w-4 text-indigo-300" />
                  {label}
                </div>
              ))}
            </div>
          </InteractiveCard>
          <InteractiveCard tilt={0} className="surface p-5 sm:p-6">
            <p className="eyebrow">Ledger context</p>
            <p className="num mt-2 text-3xl font-semibold text-slate-900">{tx.length}</p>
            <p className="mt-1 lede">
              {tx.length === 1 ? "transaction available" : "transactions available"} to analyze
            </p>
            {tx.length === 0 && (
              <Link
                to="/entry"
                className="motion-link mt-4 inline-flex items-center gap-1 text-sm font-semibold text-indigo-600 hover:underline"
              >
                Add a transaction <ArrowRight className="h-4 w-4" />
              </Link>
            )}
          </InteractiveCard>
        </aside>
      </div>
    </Page>
  );
}
