import type { Transaction, RiskSettings } from "./types";
// Deterministic seed (no Math.random at module scope). 6 months, mild upward income trend.
export function makeSeed(): Transaction[] {
  const rows: Transaction[] = [];
  const months = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
  const cust = ["Harbor Cafe", "Linden Studio", "Mesa Retail", "Oak & Pine Co."];
  const exp: [string, string, number][] = [["Rent", "Northgate Props", 4200], ["Payroll", "Staff", 9800], ["Supplies", "Paper Mill Ltd", 1400], ["Software", "Cloudware", 380], ["Utilities", "City Power", 520]];
  let i = 0;
  months.forEach((m, mi) => {
    cust.forEach((c, ci) => rows.push({ id: `t${i++}`, type: "income", category: "Sales", vendor_or_customer: c, amount: 3600 + mi * 260 + ci * 410, currency: "USD", transaction_date: `${m}-${String(5 + ci * 6).padStart(2, "0")}`, due_date: null, status: "paid", source: "manual" }));
    exp.forEach(([cat, v, a], ei) => rows.push({ id: `t${i++}`, type: "expense", category: cat, vendor_or_customer: v, amount: a + mi * (ei === 2 ? 60 : 0), currency: "USD", transaction_date: `${m}-${String(3 + ei * 5).padStart(2, "0")}`, due_date: null, status: "paid", source: "manual" }));
  });
  const ar: [string, number, string, Transaction["status"]][] = [["Mesa Retail", 6400, "2026-09-15", "overdue"], ["Linden Studio", 3200, "2026-10-01", "overdue"], ["Harbor Cafe", 2100, "2026-10-20", "overdue"], ["Oak & Pine Co.", 5200, "2026-11-28", "pending"]];
  ar.forEach(([c, a, d, s]) => rows.push({ id: `t${i++}`, type: "ar", category: "Invoice", vendor_or_customer: c, amount: a, currency: "USD", transaction_date: "2026-09-01", due_date: d, status: s, source: "manual" }));
  const ap: [string, number, string, Transaction["status"]][] = [["Paper Mill Ltd", 2800, "2026-10-30", "overdue"], ["Northgate Props", 4200, "2026-11-30", "pending"], ["Cloudware", 1140, "2026-12-05", "pending"]];
  ap.forEach(([c, a, d, s]) => rows.push({ id: `t${i++}`, type: "ap", category: "Bill", vendor_or_customer: c, amount: a, currency: "USD", transaction_date: "2026-10-01", due_date: d, status: s, source: "manual" }));
  return rows;
}
export const defaultRisk: RiskSettings = { low_cash_threshold_months: 3, warning_email: "owner@example.com", enabled: true, ar_overdue_spike_pct: 25 };
export const demoMarket = {
  fetched_at: "2026-11-14T06:00:00Z",
  indicators: [{ k: "S&P 500", v: "6,412", d: "+0.4%" }, { k: "US 10Y", v: "4.18%", d: "-3bp" }, { k: "DXY", v: "101.9", d: "+0.2%" }, { k: "WTI", v: "$71.30", d: "-1.1%" }],
  headlines: ["Small-business lending standards ease for second quarter", "Consumer spending steady into holiday season", "Freight costs dip as port congestion clears"],
};
