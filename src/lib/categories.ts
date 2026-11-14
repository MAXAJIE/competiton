// Category schema shared with the backend (backend/app/categories.py).
// Fetched from GET /api/categories so the UI can never drift from what OCR and
// the classifier produce; the bundled fallback keeps guest/offline usable.
import { useEffect, useState } from "react";
import type { TxType } from "./types";

export interface Category {
  key: string;
  label: string;
  group: string;
  description: string;
}

export type Taxonomy = Record<TxType, Category[]>;

export const FALLBACK_TAXONOMY: Taxonomy = {
  expense: [
    { key: "housing", label: "Housing", group: "Home", description: "Rent or mortgage payment" },
    { key: "utilities", label: "Utilities", group: "Home", description: "Electricity, water, gas" },
    { key: "telecom", label: "Phone & Internet", group: "Home", description: "Mobile, broadband, data" },
    { key: "groceries", label: "Groceries", group: "Everyday", description: "Supermarket and food shopping" },
    { key: "dining", label: "Dining & Cafés", group: "Everyday", description: "Restaurants, cafés, takeaway" },
    { key: "transport", label: "Transport", group: "Everyday", description: "Fuel, public transport, parking" },
    { key: "vehicle", label: "Vehicle", group: "Everyday", description: "Servicing, tyres, road tax" },
    { key: "health", label: "Health", group: "Wellbeing", description: "Doctor, dentist, pharmacy" },
    { key: "insurance", label: "Insurance", group: "Wellbeing", description: "Insurance premiums" },
    { key: "education", label: "Education", group: "Wellbeing", description: "School fees, courses, books" },
    { key: "shopping", label: "Shopping", group: "Everyday", description: "Clothes, electronics, household goods" },
    { key: "entertainment", label: "Entertainment", group: "Leisure", description: "Cinema, games, hobbies" },
    { key: "subscriptions", label: "Subscriptions", group: "Leisure", description: "Streaming, apps, memberships" },
    { key: "travel", label: "Travel", group: "Leisure", description: "Flights, hotels, holidays" },
    { key: "personal_care", label: "Personal Care", group: "Wellbeing", description: "Haircut, gym, toiletries" },
    { key: "family", label: "Family & Childcare", group: "Home", description: "Daycare, kids, family support" },
    { key: "pets", label: "Pets", group: "Home", description: "Pet food, vet, grooming" },
    { key: "home_repairs", label: "Home & Repairs", group: "Home", description: "Maintenance, repairs, cleaning" },
    { key: "debt", label: "Debt & Loans", group: "Money", description: "Loan repayments, card interest" },
    { key: "fees", label: "Bank Fees", group: "Money", description: "Bank charges, transfer fees" },
    { key: "taxes", label: "Taxes", group: "Money", description: "Income or property tax" },
    { key: "gifts", label: "Gifts & Donations", group: "Leisure", description: "Presents, charity, zakat" },
    { key: "business", label: "Work & Business", group: "Work", description: "Stock, ads, tools for side work" },
    { key: "savings", label: "Savings & Investments", group: "Money", description: "Money moved to savings" },
    { key: "other_expense", label: "Other", group: "Everyday", description: "Anything else" },
  ],
  income: [
    { key: "salary", label: "Salary", group: "Work", description: "Regular wages from an employer" },
    { key: "business_income", label: "Business Income", group: "Work", description: "Sales from your own business" },
    { key: "freelance", label: "Freelance & Side Work", group: "Work", description: "Gigs, consulting" },
    { key: "interest", label: "Interest & Dividends", group: "Money", description: "Bank interest, dividends" },
    { key: "refunds", label: "Refunds & Reimbursements", group: "Money", description: "Money returned" },
    { key: "gifts_received", label: "Gifts Received", group: "Money", description: "Presents, family support" },
    { key: "benefits", label: "Benefits & Allowances", group: "Money", description: "Pensions, aid" },
    { key: "other_income", label: "Other Income", group: "Money", description: "Anything else" },
  ],
  ar: [
    { key: "customer_invoice", label: "Customer Invoice", group: "Receivable", description: "Invoice you issued" },
    { key: "loan_given", label: "Money Lent Out", group: "Receivable", description: "Someone owes you" },
    { key: "other_receivable", label: "Other Receivable", group: "Receivable", description: "Other money owed to you" },
  ],
  ap: [
    { key: "supplier_bill", label: "Supplier Bill", group: "Payable", description: "Bill from a supplier" },
    { key: "rent_due", label: "Rent Due", group: "Payable", description: "Rent owed" },
    { key: "loan_instalment", label: "Loan Instalment Due", group: "Payable", description: "Upcoming loan payment" },
    { key: "other_payable", label: "Other Payable", group: "Payable", description: "Other money you owe" },
  ],
};

const API_URL = (import.meta.env["VITE_API_URL"] as string | undefined) ?? "http://localhost:8000";
let cache: Taxonomy | null = null;

export function useCategories(): Taxonomy {
  const [tax, setTax] = useState<Taxonomy>(cache ?? FALLBACK_TAXONOMY);
  useEffect(() => {
    if (cache) return;
    let alive = true;
    fetch(`${API_URL}/api/categories`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((t: Taxonomy) => { cache = t; if (alive) setTax(t); })
      .catch(() => { /* offline/guest → bundled fallback is identical in shape */ });
    return () => { alive = false; };
  }, []);
  return tax;
}

/** Best-fit category for a vendor/description, from the backend classifier. */
export async function suggestCategory(vendor: string, type: TxType, text = ""): Promise<{ category: string; confidence: number } | null> {
  if (!vendor.trim()) return null;
  try {
    const res = await fetch(`${API_URL}/api/categories/classify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vendor, type, text }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { category: string; confidence: number };
    return data.confidence > 0 ? data : null;
  } catch {
    return null;
  }
}

export function categoriesFor(tax: Taxonomy, type: TxType): { group: string; items: Category[] }[] {
  const out: { group: string; items: Category[] }[] = [];
  for (const c of tax[type] ?? []) {
    const g = out.find(x => x.group === c.group);
    if (g) g.items.push(c); else out.push({ group: c.group, items: [c] });
  }
  return out;
}
