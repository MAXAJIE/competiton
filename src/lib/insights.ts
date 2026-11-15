// Pure presentation helpers for the /insights page. Kept out of the route so
// they can be unit-tested without a DOM, and so every number the page shows is
// traceable to one small function.
import type { ArRiskSeverity } from "./api";

/** 0.6238 → "62%" (the model works in probabilities; the UI speaks percent). */
export function pct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

/** 18.44 → "+18.4%", -12.04 → "−12.0%" (true minus sign, not a hyphen). */
export function signedPct(value: number, digits = 1): string {
  const sign = value >= 0 ? "+" : "−";
  return `${sign}${Math.abs(value).toFixed(digits)}%`;
}

/** Projection vs the persistence baseline, as a percentage. Null when there is
 *  no usable baseline to compare against. */
export function deltaVsBaseline(value: number, baseline: number | null): number | null {
  if (baseline === null || !Number.isFinite(baseline) || baseline <= 0) return null;
  return ((value - baseline) / baseline) * 100;
}

/** "2026-12" → "Dec 2026". Returns the raw string if it is not a YYYY-MM value. */
export function formatMonth(month: string | null): string {
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return month ?? "—";
  const date = new Date(`${month}-01T12:00:00`);
  if (Number.isNaN(date.getTime())) return month;
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(date);
}

export type DueTone = "overdue" | "today" | "soon" | "later";

/** Payment terms in words. Negative days mean the due date has passed. */
export function dueLabel(days: number): { text: string; tone: DueTone } {
  if (days < 0) return { text: `${Math.abs(days)}d overdue`, tone: "overdue" };
  if (days === 0) return { text: "Due today", tone: "today" };
  if (days <= 7) return { text: `in ${days}d`, tone: "soon" };
  return { text: `in ${days}d`, tone: "later" };
}

/** The backend reports an observed late *rate* plus how many outcomes it is
 *  based on; "2 of 5 late" is the honest way to show that pair. The row being
 *  scored is excluded from its own history by the backend. */
export function lateHistory(rate: number, priorCount: number): string {
  if (priorCount <= 0) return "no prior outcomes";
  const late = Math.round(rate * priorCount);
  return `${late} of ${priorCount} late`;
}

export function severityLabel(severity: ArRiskSeverity): string {
  return severity === "high" ? "High" : severity === "medium" ? "Medium" : "Low";
}

/** Chip classes per severity. Colour is never the only signal — the label is
 *  always rendered next to it. */
export function severityChipClass(severity: ArRiskSeverity): string {
  if (severity === "high") return "border-rose-200 bg-rose-50 text-rose-700";
  if (severity === "medium") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

/** The backend caps `top` at 6 rows; saying so prevents the list from reading
 *  as the whole book. Ordering is not purely predicted: an invoice that is
 *  already late is certain, so it leads and is ranked by amount x days overdue. */
export function topNStatement(shown: number, scored: number): string {
  if (scored <= 0) return "No open rows to score";
  const order = "money already late first, then predicted risk";
  if (scored > shown) return `Top ${shown} of ${scored} open rows — ${order}`;
  return scored === 1 ? "The single open row, scored" : `All ${scored} open rows — ${order}`;
}
