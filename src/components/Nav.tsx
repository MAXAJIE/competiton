import { Link } from "@tanstack/react-router";
import {
  ArrowLeftRight,
  BrainCircuit,
  History,
  LayoutDashboard,
  LogIn,
  LogOut,
  Menu,
  MessageCircle,
  Settings2,
  ShieldCheck,
  Sparkles,
  X,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { signOut } from "@/lib/api";
import { useStore } from "@/lib/store";

const links: {
  to: "/" | "/advisor" | "/entry" | "/history" | "/insights" | "/settings";
  label: string;
  icon: LucideIcon;
}[] = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/advisor", label: "AI advisor", icon: MessageCircle },
  { to: "/entry", label: "Transactions", icon: ArrowLeftRight },
  { to: "/history", label: "History", icon: History },
  { to: "/insights", label: "Model insights", icon: BrainCircuit },
  { to: "/settings", label: "Risk settings", icon: Settings2 },
];

function NavigationLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Main navigation" className="space-y-1">
      {links.map(({ to, label, icon: Icon }) => (
        <Link
          key={to}
          to={to}
          activeOptions={{ exact: true }}
          onClick={onNavigate}
          className="nav-link group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-400 transition-colors hover:bg-white/7 hover:text-white [&.active]:bg-white/10 [&.active]:text-white"
        >
          <Icon
            aria-hidden
            className="h-[18px] w-[18px] text-slate-500 transition-colors group-hover:text-slate-300 group-[.active]:text-indigo-300"
          />
          <span>{label}</span>
          <span className="ml-auto h-1.5 w-1.5 rounded-full bg-indigo-400 opacity-0 transition-opacity group-[.active]:opacity-100" />
        </Link>
      ))}
    </nav>
  );
}

export function Nav() {
  const { mode, setMode, setTx } = useStore();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const isGuest = mode === "guest";

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      location.assign("/login");
    } catch (error) {
      setSigningOut(false);
      setConfirmOpen(false);
      toast.error(error instanceof Error ? error.message : "Could not sign out.");
    }
  };

  // Guest data lives in this tab only, so leaving the session clears it. Nothing
  // was ever sent to a server, which is exactly what the confirmation says.
  const handleGuestExit = () => {
    setMode(null);
    setTx([]);
    location.assign("/login");
  };

  const confirm = isGuest
    ? {
        title: "Leave the guest session?",
        description:
          "The demo ledger lives in this browser tab only, so leaving clears it. Nothing was saved to an account, and you can start a fresh guest session any time.",
        confirmLabel: "Yes, leave guest session",
        cancelLabel: "Keep exploring",
        onConfirm: handleGuestExit,
      }
    : {
        title: "Log out of your account?",
        description:
          "You'll go back to the login screen. Your ledger, receipts and settings stay saved in your account — nothing is deleted.",
        confirmLabel: "Yes, log me out",
        cancelLabel: "Stay signed in",
        onConfirm: handleSignOut,
      };

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[264px] flex-col bg-[#111c31] px-5 py-6 text-white lg:flex">
        <Link to="/" className="mb-10 flex items-center gap-3 px-2">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-500 text-white shadow-lg shadow-indigo-950/30">
            <Sparkles aria-hidden className="h-5 w-5" />
          </span>
          <span>
            <span className="block font-display text-[1.45rem] leading-none tracking-tight">
              Cashflow
            </span>
            <span className="mt-1 block text-[0.62rem] font-semibold uppercase tracking-[0.2em] text-slate-400">
              private finance
            </span>
          </span>
        </Link>

        <p className="eyebrow mb-3 px-3 text-slate-400">Workspace</p>
        <NavigationLinks />

        <div className="mt-auto">
          <div className="rounded-2xl border border-white/8 bg-white/5 p-4">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-400/10 text-emerald-300">
                <ShieldCheck aria-hidden className="h-4 w-4" />
              </span>
              <div>
                <p className="text-sm font-semibold text-slate-100">Your numbers, protected</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-400">
                  {mode === "guest"
                    ? "Guest data stays in this browser."
                    : "Private by design. Always yours."}
                </p>
              </div>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between border-t border-white/10 px-2 pt-4">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-700 text-xs font-semibold text-slate-100">
                {mode === "user" ? "ME" : mode === "guest" ? "G" : "•"}
              </span>
              <div>
                <p className="text-xs font-semibold text-slate-200">
                  {mode === "user"
                    ? "Your workspace"
                    : mode === "guest"
                      ? "Guest workspace"
                      : "Choose a workspace"}
                </p>
                <p className="mt-0.5 text-[0.65rem] text-slate-400">
                  {mode === "user"
                    ? "Signed in"
                    : mode === "guest"
                      ? "Demo session"
                      : "Sign in or explore"}
                </p>
              </div>
            </div>
            {mode ? (
              // One control only: signing out lands on /login, so a separate
              // "sign in" shortcut next to it would just be a second door to
              // the same page.
              <button
                type="button"
                onClick={() => setConfirmOpen(true)}
                aria-label={isGuest ? "Leave guest session" : "Sign out"}
                aria-haspopup="dialog"
                className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
              >
                <LogOut aria-hidden className="h-4 w-4" />
              </button>
            ) : (
              <Link
                to="/login"
                aria-label="Sign in"
                className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
              >
                <LogIn aria-hidden className="h-4 w-4" />
              </Link>
            )}
          </div>
        </div>
      </aside>

      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200/80 bg-white/90 px-4 py-3 backdrop-blur-lg lg:hidden">
        <Link to="/" className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#111c31] text-white">
            <Sparkles aria-hidden className="h-4 w-4" />
          </span>
          <span className="font-display text-xl">Cashflow</span>
        </Link>
        <button
          type="button"
          aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((open) => !open)}
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700"
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </header>

      {mobileOpen && (
        <div className="fixed inset-x-0 top-[65px] z-30 animate-in slide-in-from-top-2 border-b border-slate-200 bg-white px-4 py-4 shadow-xl duration-200 lg:hidden">
          <NavigationLinks onNavigate={() => setMobileOpen(false)} />
          <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4">
            <span className="text-sm text-slate-600">
              {mode === "user"
                ? "Signed-in workspace"
                : mode === "guest"
                  ? "Guest session"
                  : "Choose a workspace"}
            </span>
            {mode ? (
              <button
                type="button"
                onClick={() => {
                  setMobileOpen(false);
                  setConfirmOpen(true);
                }}
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
              >
                <LogOut className="h-4 w-4" /> Sign out
              </button>
            ) : (
              <Link
                to="/login"
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
              >
                <LogIn className="h-4 w-4" /> Sign in
              </Link>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        onConfirm={confirm.onConfirm}
        title={confirm.title}
        description={confirm.description}
        confirmLabel={confirm.confirmLabel}
        cancelLabel={confirm.cancelLabel}
        busy={!isGuest && signingOut}
        busyLabel="Signing out…"
        icon={LogOut}
      />
    </>
  );
}
