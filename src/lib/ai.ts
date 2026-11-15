// AI access settings — where the OpenRouter key comes from.
//
// Two choices, by design:
//   "server" — use the key the backend already holds (the operator's), no input.
//   "byok"   — the user's own OpenRouter key.
//
// A BYOK key is kept in this browser's localStorage and sent per request as
// X-OpenRouter-Key. It is never written to the database: the schema is
// Lovable-managed, and storing a customer's key would make us a custodian of
// their credentials for no reason. Trade-off, stated in the UI: a key in this
// browser is readable by anything running in this origin (XSS), so we keep it
// out of URLs and logs and let the user delete it in one click.
import type { AiConfig } from "./api";

export type AiMode = "server" | "byok";

export interface AiSettings {
  mode: AiMode;
  /** Present only for BYOK. */
  key?: string;
  /** When the key was saved — shown in Settings so a stale key is obvious. */
  savedAt?: string;
}

const STORAGE_KEY = "cashflow.ai";

export function getAiSettings(): AiSettings | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AiSettings;
    if (parsed.mode !== "server" && parsed.mode !== "byok") return null;
    if (parsed.mode === "byok" && !parsed.key) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setAiSettings(settings: AiSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* private mode / quota — the choice simply won't persist */
  }
}

export function clearAiSettings(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** True when this browser is configured to send its own key. */
export function usingOwnKey(): boolean {
  return getAiSettings()?.mode === "byok";
}

/** The header value for BYOK calls, or undefined to let the server decide. */
export function aiKeyHeader(): Record<string, string> {
  const settings = getAiSettings();
  if (settings?.mode === "byok" && settings.key) {
    return { "X-OpenRouter-Key": settings.key };
  }
  return {};
}

/** Masked form for display: sk-or-v1-…c4f2 */
export function maskKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 12) return "••••";
  return `${trimmed.slice(0, 9)}…${trimmed.slice(-4)}`;
}

/** Which option is actually usable, given what the backend supports. */
export function describeAccess(config: AiConfig | null, settings: AiSettings | null): string {
  if (!config) return "AI access: unknown (backend not reachable)";
  if (settings?.mode === "byok") return "AI access: your own OpenRouter key";
  if (config.server_key) return "AI access: this server's key";
  return "AI access: no key configured";
}
