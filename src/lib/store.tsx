import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { RiskSettings, Transaction } from "./types";
import { defaultRisk, makeSeed } from "./demo-data";
import { fetchTransactions, fetchMarketSnapshot } from "./api";
import { settleable } from "./settlement";
import { supabase } from "./supabase";

type Mode = "guest" | "user" | null;
interface S {
  tx: Transaction[];
  /**
   * Record a transaction. A paid income row from a customer who owes you money
   * closes that receivable: the backend returns the ids it settled for a
   * signed-in user, and guest mode runs the same rules locally (settlement.ts).
   * Returns the receivables that were closed, so the caller can say so.
   */
  addTx: (t: Transaction, settledIds?: string[]) => Transaction[];
  setTx: (tx: Transaction[]) => void;
  risk: RiskSettings;
  setRisk: (r: RiskSettings) => void;
  mode: Mode;
  setMode: (m: Mode) => void;
  /** false until the session/ledger check has finished (avoids a flash of empty state) */
  loaded: boolean;
}
const Ctx = createContext<S | null>(null);

// Guest mode holds demo data in this tab only (SKILL.md §8); signed-in users
// load their own ledger from the backend and start EMPTY until they add entries.
export function StoreProvider({ children }: { children: ReactNode }) {
  const [tx, setTx] = useState<Transaction[]>([]);
  const [risk, setRisk] = useState<RiskSettings>(defaultRisk);
  const [mode, setMode] = useState<Mode>(null);
  const [loaded, setLoaded] = useState(false);

  // Restore a persisted Supabase session (e.g. returning from Google OAuth)
  // and swap in the user's real ledger — which may legitimately be empty.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (cancelled) return;
        if (data.session) {
          setMode("user");
          const rows = await fetchTransactions();
          if (!cancelled) setTx(rows);
        }
      } catch (e) {
        console.warn("Could not load ledger from backend:", e);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Guest mode is the only place demo data appears — and only once.
  useEffect(() => {
    if (mode === "guest" && tx.length === 0) setTx(makeSeed());
  }, [mode, tx.length]);

  const addTx = (t: Transaction, settledIds?: string[]): Transaction[] => {
    // Signed-in: the backend already settled inside the save request and sends
    // the ids back (possibly an empty list). Undefined means no server call
    // happened — guest mode, or a signed-out tab — so apply the mirrored rule.
    const ids = settledIds ?? settleable(tx, t).map(r => r.id ?? "");
    const closed = tx.filter(r => r.id && ids.includes(r.id));
    setTx(prev => [
      ...prev.map(r => (r.id && ids.includes(r.id) ? { ...r, status: "paid" as const } : r)),
      t,
    ]);
    return closed;
  };

  return <Ctx.Provider value={{ tx, addTx, setTx, risk, setRisk, mode, setMode, loaded }}>{children}</Ctx.Provider>;
}
export const useStore = () => { const c = useContext(Ctx); if (!c) throw new Error("no store"); return c; };

export { fetchMarketSnapshot };
