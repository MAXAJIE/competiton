// AI access chooser — shared by the post-login setup page and Settings.
//
// Two routes to the same models, by design:
//   "server" — the operator's OpenRouter key already on the backend. Nothing to paste.
//   "byok"   — the user's own OpenRouter key, kept in this browser (see lib/ai.ts).
//
// Only OpenRouter is offered: one provider, one key format, one endpoint to
// validate. The backend decides nothing here — it just uses the key that
// arrives in X-OpenRouter-Key, or its own when the header is absent.
import { useEffect, useState } from "react";
import {
  Check,
  CircleAlert,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  ServerCog,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { fetchAiConfig, testAiKey, type AiConfig, type KeyCheck } from "@/lib/api";
import {
  describeAccess,
  getAiSettings,
  maskKey,
  setAiSettings,
  type AiMode,
  type AiSettings,
} from "@/lib/ai";

const KEYS_URL = "https://openrouter.ai/keys";

/** A failed key check that says nothing about the key — the server could not ask. */
function backendCouldNotCheck(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /failed to fetch|network|404|not found|could not reach|502|503/i.test(message);
}

function formatWhen(iso: string | undefined): string {
  if (!iso) return "saved";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "saved";
  return `saved ${date.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
}

export function AiAccessPanel({ onSaved }: { onSaved?: (mode: AiMode) => void }) {
  // undefined = still asking the backend what it supports.
  const [config, setConfig] = useState<AiConfig | null | undefined>(undefined);
  const [stored, setStored] = useState<AiSettings | null>(null);
  const [mode, setMode] = useState<AiMode>("server");
  const [keyInput, setKeyInput] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<KeyCheck | null>(null);
  // The exact string that OpenRouter accepted, so re-saving skips a second call.
  const [verifiedKey, setVerifiedKey] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const existing = getAiSettings();
    setStored(existing);
    if (existing) {
      setMode(existing.mode);
      if (existing.mode === "byok" && existing.key) setKeyInput(existing.key);
    }
    fetchAiConfig().then((next) => {
      if (active) setConfig(next);
    });
    return () => {
      active = false;
    };
  }, []);

  const checking = config === undefined;
  const serverKey = config?.server_key ?? false;
  const trimmed = keyInput.trim();
  const looksLikeOpenRouter = trimmed.startsWith("sk-or-") || trimmed.length > 20;

  const runCheck = async (key: string) => {
    const result = await testAiKey(key);
    setCheck(result);
    setVerifiedKey(key);
    return result;
  };

  const testNow = async () => {
    if (!trimmed) {
      toast.error("Paste your OpenRouter key first.");
      return;
    }
    setBusy(true);
    try {
      const result = await runCheck(trimmed);
      toast.success(result.free_tier ? "Key works (free tier)." : `Key works — ${result.label}.`);
    } catch (error) {
      setCheck(null);
      setVerifiedKey(null);
      toast.error(error instanceof Error ? error.message : "Could not check that key.");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (mode === "server") {
      const next: AiSettings = { mode: "server" };
      setAiSettings(next);
      setStored(next);
      setCheck(null);
      setVerifiedKey(null);
      toast.success(
        serverKey
          ? "AI access saved — using this server's key."
          : "AI access saved — the advisor will use built-in rules until a key is added.",
      );
      onSaved?.("server");
      return;
    }

    if (!trimmed) {
      toast.error("Paste your OpenRouter key first.");
      return;
    }

    setBusy(true);
    try {
      if (verifiedKey !== trimmed) await runCheck(trimmed);
      const next: AiSettings = {
        mode: "byok",
        key: trimmed,
        savedAt: new Date().toISOString(),
      };
      setAiSettings(next);
      setStored(next);
      toast.success("Your OpenRouter key is saved in this browser.");
      onSaved?.("byok");
    } catch (error) {
      if (backendCouldNotCheck(error)) {
        // Older backend / key-check endpoint missing: the key may still be fine,
        // so save it with the caveat stated rather than blocking the user.
        const next: AiSettings = {
          mode: "byok",
          key: trimmed,
          savedAt: new Date().toISOString(),
        };
        setAiSettings(next);
        setStored(next);
        setVerifiedKey(null);
        toast.warning("Key saved, but this server could not verify it. It is used as-is.");
      } else {
        setCheck(null);
        setVerifiedKey(null);
        toast.error(error instanceof Error ? error.message : "OpenRouter rejected that key.");
      }
    } finally {
      setBusy(false);
    }
  };

  const forgetKey = () => {
    const next: AiSettings = { mode: "server" };
    setAiSettings(next);
    setStored(next);
    setMode("server");
    setKeyInput("");
    setCheck(null);
    setVerifiedKey(null);
    toast.success("Key removed from this browser.");
  };

  return (
    <div className="space-y-5">
      <div
        role="radiogroup"
        aria-label="Where the AI key comes from"
        className="grid gap-4 md:grid-cols-2"
      >
        <Choice
          selected={mode === "server"}
          onSelect={() => setMode("server")}
          icon={ServerCog}
          title="Use this server's key"
          subtitle={
            serverKey
              ? "Included with your workspace. Nothing to paste, nothing stored in your browser."
              : "This server has no key configured yet — the advisor will answer with built-in rules only."
          }
          tone={serverKey ? "ok" : "warn"}
          badge={serverKey ? "Recommended" : "No server key"}
        />
        <Choice
          selected={mode === "byok"}
          onSelect={() => setMode("byok")}
          icon={KeyRound}
          title="Use my own OpenRouter key"
          subtitle="Billed to your OpenRouter account. The key stays in this browser and is sent with each AI request."
          tone="neutral"
          badge="OpenRouter only"
        />
      </div>

      {mode === "byok" && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 sm:p-5">
          <label className="block">
            <span className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700">
              <KeyRound className="h-4 w-4 text-slate-400" /> OpenRouter API key
            </span>
            <span className="flex flex-col gap-2 sm:flex-row">
              <span className="relative block flex-1">
                <input
                  type={reveal ? "text" : "password"}
                  className="field pr-11 font-mono text-sm"
                  placeholder="sk-or-v1-…"
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  value={keyInput}
                  onChange={(event) => {
                    setKeyInput(event.target.value);
                    // A changed key is no longer the one that passed.
                    if (event.target.value.trim() !== verifiedKey) setCheck(null);
                  }}
                  aria-describedby="openrouter-key-help"
                />
                <button
                  type="button"
                  onClick={() => setReveal((shown) => !shown)}
                  aria-label={reveal ? "Hide key" : "Show key"}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-slate-400 transition-colors hover:text-slate-700"
                >
                  {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </span>
              <button
                type="button"
                className="btn shrink-0"
                disabled={busy || !trimmed}
                onClick={() => void testNow()}
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ShieldCheck className="h-4 w-4" />
                )}
                Test key
              </button>
            </span>
          </label>

          <p
            id="openrouter-key-help"
            className="mt-2 text-xs leading-relaxed text-muted-foreground"
          >
            Create a key at{" "}
            <a
              href={KEYS_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="font-medium text-indigo-600 hover:underline"
            >
              openrouter.ai/keys <ExternalLink className="inline h-3 w-3" aria-hidden />
            </a>
            . Only OpenRouter is supported for now.
          </p>

          {trimmed.length > 0 && !looksLikeOpenRouter && (
            <p className="mt-2 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              OpenRouter keys usually start with <span className="font-mono">sk-or-</span>. Paste it
              in full — the check above will tell you if it works.
            </p>
          )}

          {check && <KeyFacts check={check} />}

          {stored?.mode === "byok" && stored.key && (
            <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
              Saved in this browser: <span className="font-mono">{maskKey(stored.key)}</span>
              <span aria-hidden>·</span>
              {formatWhen(stored.savedAt)}
            </p>
          )}
        </div>
      )}

      {mode === "server" && !serverKey && !checking && (
        <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-3.5 py-3 text-xs leading-relaxed text-amber-800">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          This server has no OpenRouter key, so AI answers fall back to the calculator's own rules.
          Add your own key to get model-written answers.
        </p>
      )}

      <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-700">
            {checking
              ? "Checking what this server supports…"
              : describeAccess(config ?? null, stored)}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {mode === "byok"
              ? "Stored only in this browser's localStorage — never in our database, URLs or logs."
              : "Requests go out with the server's key; your account never sends a key."}
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
          {stored?.mode === "byok" && (
            <button type="button" className="btn" disabled={busy} onClick={forgetKey}>
              <Trash2 className="h-4 w-4" /> Remove key
            </button>
          )}
          <button
            type="button"
            className="btn btn-solid"
            disabled={busy || checking}
            onClick={() => void save()}
          >
            {busy ? (
              <span
                className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
                aria-hidden
              />
            ) : (
              <Check className="h-4 w-4" />
            )}
            {mode === "server" ? "Use this server's key" : "Save my key"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Choice({
  selected,
  onSelect,
  icon: Icon,
  title,
  subtitle,
  badge,
  tone,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: typeof KeyRound;
  title: string;
  subtitle: string;
  badge: string;
  tone: "ok" | "warn" | "neutral";
}) {
  const toneClass =
    tone === "ok"
      ? "bg-emerald-50 text-emerald-700"
      : tone === "warn"
        ? "bg-amber-50 text-amber-700"
        : "bg-indigo-50 text-indigo-700";

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      // The visible card leads with a badge and ends with "Selected", so spell the
      // label out instead of letting those two words open the spoken name.
      aria-label={`${title}. ${subtitle}`}
      onClick={onSelect}
      className={`group relative flex h-full flex-col rounded-2xl border p-4 text-left transition-all sm:p-5 ${
        selected
          ? "border-indigo-500 bg-white shadow-[0_10px_30px_rgba(73,104,232,0.12)]"
          : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-[0_8px_24px_rgba(22,37,63,0.06)]"
      }`}
    >
      <span className="flex items-start justify-between gap-3">
        <span
          className={`flex h-10 w-10 items-center justify-center rounded-xl ${
            selected ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-500"
          }`}
        >
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <span className={`rounded-full px-2.5 py-1 text-[0.65rem] font-semibold ${toneClass}`}>
          {badge}
        </span>
      </span>
      <span className="mt-4 block font-display text-lg leading-tight text-slate-900">{title}</span>
      <span className="mt-1.5 block text-xs leading-relaxed text-slate-500">{subtitle}</span>
      <span
        aria-hidden
        className={`mt-4 inline-flex items-center gap-1.5 text-xs font-semibold ${
          selected ? "text-indigo-600" : "text-slate-400"
        }`}
      >
        <span
          className={`flex h-4 w-4 items-center justify-center rounded-full border ${
            selected ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300"
          }`}
        >
          {selected && <Check className="h-2.5 w-2.5" />}
        </span>
        {selected ? "Selected" : "Choose this"}
      </span>
    </button>
  );
}

function KeyFacts({ check }: { check: KeyCheck }) {
  const spent =
    check.usage === null
      ? null
      : check.limit === null
        ? `$${check.usage.toFixed(2)} used, no cap`
        : `$${check.usage.toFixed(2)} of $${check.limit.toFixed(2)} used`;

  return (
    <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
      <Check className="h-4 w-4 shrink-0" aria-hidden />
      <span className="font-semibold">{check.label}</span>
      {check.free_tier && (
        <span className="rounded-full bg-emerald-600/10 px-2 py-0.5">free tier</span>
      )}
      {spent && (
        <>
          <span aria-hidden>·</span>
          <span className="font-mono">{spent}</span>
        </>
      )}
    </p>
  );
}
