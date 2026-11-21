// Guest-mode mirror of backend/app/settlement.py.
//
// The backend is authoritative: for a signed-in user it settles receivables
// inside the same request that saves the payment and returns the closed ids.
// Guest mode never talks to the server (SKILL.md §8), so the same rules are
// applied here on the in-memory ledger. Keep the two in step — the rule set is
// small on purpose: same customer name, oldest due first, only while the
// payment still covers the invoice.

import type { Transaction } from "./types";

const COMPANY_SUFFIXES = [
  "co",
  "company",
  "corp",
  "corporation",
  "inc",
  "incorporated",
  "llc",
  "ltd",
  "limited",
  "llp",
  "plc",
  "pte",
  "gmbh",
  "sa",
  "bv",
  "ag",
  "srl",
  "pty",
  "enterprise",
  "enterprises",
  "trading",
];

/** Shortest name that may match as a prefix of a longer one. */
const PREFIX_MIN = 6;
const AMOUNT_TOLERANCE = 1;

export function normaliseParty(name: string): string {
  const words = (name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  while (words.length && COMPANY_SUFFIXES.includes(words[words.length - 1] ?? "")) words.pop();
  return words.join(" ");
}

export function sameParty(a: string, b: string): boolean {
  const na = normaliseParty(a);
  const nb = normaliseParty(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const [shortName, longName] = na.length <= nb.length ? [na, nb] : [nb, na];
  return shortName.length >= PREFIX_MIN && longName.startsWith(`${shortName} `);
}

/** Open invoices/bills a recorded payment closes, oldest due first. */
export function settleable(tx: Transaction[], payment: Transaction): Transaction[] {
  // Money in closes receivables; money out closes payables. An unpaid row is a
  // promise, not a movement, so it settles nothing.
  const itemType = payment.type === "income" ? "ar" : payment.type === "expense" ? "ap" : null;
  if (!itemType || payment.status !== "paid") return [];
  let remaining = Number(payment.amount);
  if (!Number.isFinite(remaining) || remaining <= 0) return [];

  const candidates = tx
    .filter(
      (r) =>
        r.type === itemType &&
        r.status !== "paid" &&
        sameParty(r.vendor_or_customer, payment.vendor_or_customer),
    )
    .sort((a, b) => {
      const ad = a.due_date ?? "9999-12-31";
      const bd = b.due_date ?? "9999-12-31";
      return ad === bd
        ? a.transaction_date.localeCompare(b.transaction_date)
        : ad.localeCompare(bd);
    });

  const closed: Transaction[] = [];
  for (const row of candidates) {
    const amount = Number(row.amount);
    if (amount > remaining + AMOUNT_TOLERANCE) continue; // bigger than what is left
    closed.push(row);
    remaining -= amount;
  }
  return closed;
}

/**
 * A paid invoice/bill is a statement that the money moved. Turn it into the
 * matching income/expense row so the ledger records cash AND the existing open
 * item can be settled; AR/AP rows themselves are never born "paid".
 */
export function asPayment(t: Transaction): Transaction {
  if (t.type === "ar" && t.status === "paid") {
    return { ...t, type: "income", category: "AR", due_date: null, status: "paid" };
  }
  if (t.type === "ap" && t.status === "paid") {
    return { ...t, type: "expense", category: "Work & Business", due_date: null, status: "paid" };
  }
  return t;
}
