import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { RiskSettings, Transaction } from "./types";
import { defaultRisk, makeSeed } from "./demo-data";
import { fetchTransactions, fetchMarketSnapshot } from "./api";
import { supabase } from "./supabase";

type Mode = "guest" | "user" | null;
interface S {
  tx: Transaction[];
  /** Adds the row; any settled receivable ids flip to paid. Returns those rows. */
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

    // A payment can settle one or more open receivables (backend settlement.py is
  // the authority; the ids it returns are flipped here so the UI matches).
  const addTx = (t: Transaction, settledIds?: string[]): Transaction[] => {
    const ids = new Set(settledIds ?? []);
    const closed = ids.size ? tx.filter(r => r.id && ids.has(r.id)) : [];
    const row = t.created_at ? t : { ...t, created_at: new Date().toISOString() };
    setTx(prev => [
      ...prev.map(r => (r.id && ids.has(r.id) ? { ...r, status: "paid" as const } : r)),
      row,
    ]);
    return closed;
  };

  return <Ctx.Provider value={{ tx, addTx, setTx, risk, setRisk, mode, setMode, loaded }}>{children}</Ctx.Provider>;
}
export const useStore = () => { const c = useContext(Ctx); if (!c) throw new Error("no store"); return c; };

export { fetchMarketSnapshot };
