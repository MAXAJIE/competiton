import { createContext, useContext, useState, type ReactNode } from "react";
import type { RiskSettings, Transaction } from "./types";
import { defaultRisk, makeSeed } from "./demo-data";
type Mode = "guest" | "user" | null;
interface S { tx: Transaction[]; addTx: (t: Transaction) => void; risk: RiskSettings; setRisk: (r: RiskSettings) => void; mode: Mode; setMode: (m: Mode) => void; }
const Ctx = createContext<S | null>(null);
// In-memory session store. CONNECTION POINT: for real users, load from Supabase instead of makeSeed().
export function StoreProvider({ children }: { children: ReactNode }) {
  const [tx, setTx] = useState(() => makeSeed());
  const [risk, setRisk] = useState(defaultRisk);
  const [mode, setMode] = useState<Mode>(null);
  return <Ctx.Provider value={{ tx, addTx: t => setTx(p => [...p, t]), risk, setRisk, mode, setMode }}>{children}</Ctx.Provider>;
}
export const useStore = () => { const c = useContext(Ctx); if (!c) throw new Error("no store"); return c; };
