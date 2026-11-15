import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Eraser,
  FileText,
  ShieldCheck,
  Trash2,
  UserX,
} from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { InteractiveCard } from "@/components/InteractiveCard";
import { useStore } from "@/lib/store";
import {
  applyRetention,
  deleteMyAccount,
  deleteMyData,
  fetchApiCapabilities,
  fetchConsent,
  fetchLegalConfig,
  type ApiCapabilities,
  type ConsentRecord,
  type LegalConfig,
} from "@/lib/api";
import { MIN_AGE, RETENTION, TERMS, PRIVACY } from "@/lib/legal";

/**
 * Data & privacy: what is stored, how long it is kept, and the two delete
 * buttons. Everything here is a real call to the backend — not a local clear
 * with a reassuring message — because "your data is deleted" has to be true.
 */
export function DataPrivacyPanel() {
  const { mode, setTx, setRisk } = useStore();
  const [consent, setConsent] = useState<ConsentRecord | null>(null);
  const [legal, setLegal] = useState<LegalConfig | null>(null);
  const [caps, setCaps] = useState<ApiCapabilities | null>(null);
  const [busy, setBusy] = useState(false);
  const [dataDialog, setDataDialog] = useState(false);
  const [accountDialog, setAccountDialog] = useState(false);
  const [typed, setTyped] = useState("");

  const signedIn = mode === "user";
  const backendCanDelete = caps === null || caps.features.includes("delete-account");

  useEffect(() => {
    if (!signedIn) return;
    let active = true;
    fetchConsent().then((state) => {
      if (active && state) setConsent(state.consent);
    });
    fetchLegalConfig().then((config) => {
      if (active) setLegal(config);
    });
    // Ask the backend what it can actually do. A deployment older than this
    // build has no delete route, and the buttons would fail with a bare 404 —
    // say it up front instead.
    fetchApiCapabilities().then((abilities) => {
      if (active) setCaps(abilities);
    });
    return () => {
      active = false;
    };
  }, [signedIn]);

  // The backend is the authority; the bundled constants are the fallback so the
  // policy text still shows numbers when the API is unreachable.
  const retention = useMemo(
    () => ({
      transactionsDays: legal?.retention.transactions_days ?? RETENTION.transactionsDays,
      documentsDays: legal?.retention.documents_days ?? RETENTION.documentsDays,
      maxTransactions: legal?.retention.max_transactions ?? RETENTION.maxTransactions,
      maxDocuments: legal?.retention.max_documents ?? RETENTION.maxDocuments,
    }),
    [legal],
  );

  const wipeData = async () => {
    setBusy(true);
    try {
      const removed = await deleteMyData();
      setTx([]);
      // The server now has no settings row, so its defaults apply. Mirror those
      // exactly: the demo seed's owner@example.com is not a real account's email.
      setRisk({
        low_cash_threshold_months: 3,
        warning_email: "",
        enabled: true,
        ar_overdue_spike_pct: 25,
      });
      setDataDialog(false);
      toast.success(
        `Deleted ${removed.transactions} transactions, ${removed.documents} scans and ${removed.uploads} uploaded files.`,
      );
      setConsent(await fetchConsent().then((state) => state?.consent ?? null));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete your data.");
    } finally {
      setBusy(false);
    }
  };

  const wipeAccount = async () => {
    setBusy(true);
    try {
      await deleteMyAccount();
      location.assign("/login");
    } catch (error) {
      setBusy(false);
      setAccountDialog(false);
      toast.error(error instanceof Error ? error.message : "Could not delete the account.");
    }
  };

  const pruneNow = async () => {
    setBusy(true);
    try {
      const removed = await applyRetention();
      toast.success(
        removed.transactions + removed.documents + removed.uploads === 0
          ? "Nothing was older than the retention window."
          : `Removed ${removed.transactions} old transactions and ${removed.documents} old scans.`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not run the cleanup.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      {!signedIn ? (
        <p className="flex items-start gap-2 rounded-2xl bg-slate-50 px-4 py-3.5 text-xs leading-relaxed text-slate-600">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden />
          You are in a guest session: the demo ledger lives in this browser tab only, so there is
          nothing stored on a server to delete. Sign in to manage an account.
        </p>
      ) : (
        <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3.5">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
          <div className="text-sm leading-relaxed text-emerald-900">
            <p className="font-semibold">
              You affirmed you are {MIN_AGE}+ and accepted the Terms (v
              {consent?.terms_version ?? TERMS.version}) and Privacy Policy (v
              {consent?.privacy_version ?? PRIVACY.version}).
            </p>
            <p className="mt-0.5 text-xs text-emerald-800/80">
              {consent?.accepted_at
                ? `Recorded ${new Date(consent.accepted_at).toLocaleString()}`
                : "The record could not be loaded right now."}
            </p>
          </div>
        </div>
      )}

      <InteractiveCard ribbon={false} className="surface p-5 sm:p-7">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
            <Database className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <p className="eyebrow">What is stored</p>
            <h3 className="mt-1 text-2xl">Nothing we do not need</h3>
            <p className="mt-1 lede">
              Your email, the rows you enter or confirm, the scans you upload and your alert
              settings. No ads, no analytics, no profile built for marketing.
            </p>
          </div>
        </div>

        <dl className="mt-6 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-100 px-4 py-3.5">
            <dt className="text-xs text-muted-foreground">Transactions kept</dt>
            <dd className="mt-1 text-sm font-medium text-slate-800">
              {retention.transactionsDays} days · up to {retention.maxTransactions} rows
            </dd>
          </div>
          <div className="rounded-xl border border-slate-100 px-4 py-3.5">
            <dt className="text-xs text-muted-foreground">Scanned files kept</dt>
            <dd className="mt-1 text-sm font-medium text-slate-800">
              {retention.documentsDays} days · up to {retention.maxDocuments} documents
            </dd>
          </div>
        </dl>

        <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
          The cleanup runs automatically. You can also run it now, or read the full{" "}
          <Link to="/privacy" className="font-medium text-indigo-600 hover:underline">
            Privacy Policy
          </Link>{" "}
          and{" "}
          <Link to="/terms" className="font-medium text-indigo-600 hover:underline">
            Terms of Use
          </Link>
          .
        </p>

        {signedIn && (
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <button type="button" className="btn" disabled={busy} onClick={() => void pruneNow()}>
              <Eraser className="h-4 w-4" /> Run cleanup now
            </button>
            <Link to="/privacy" className="btn">
              <FileText className="h-4 w-4" /> Read the policy
            </Link>
          </div>
        )}
      </InteractiveCard>

      {signedIn && (
        <InteractiveCard ribbon={false} className="surface p-5 sm:p-7">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
              <Trash2 className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <p className="eyebrow">Delete</p>
              <h3 className="mt-1 text-2xl">Erase what you stored</h3>
              <p className="mt-1 lede">
                Two levels: clear the ledger and scans but keep the account, or remove the account
                itself. Neither can be undone.
              </p>
            </div>
          </div>

          {!backendCanDelete && (
            <div className="mt-5 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
              <p>
                <span className="font-semibold">
                  This backend is v{caps?.version ?? "older"} and has no delete endpoints.
                </span>{" "}
                Nothing will be removed until it is redeployed from this repository's{" "}
                <code className="rounded bg-amber-100 px-1">backend/</code> folder. Your data is
                still there — this page cannot erase it yet.
              </p>
            </div>
          )}

          <div className="mt-6 space-y-4">
            <div className="flex flex-col gap-3 rounded-xl border border-slate-100 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium text-slate-700">Delete all my data</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Removes transactions, scans, uploaded files and alert settings. Your account stays
                  and you keep your sign-in.
                </p>
              </div>
              <button
                type="button"
                className="btn shrink-0"
                disabled={busy}
                onClick={() => setDataDialog(true)}
              >
                <Eraser className="h-4 w-4" /> Delete my data
              </button>
            </div>

            <div className="rounded-xl border border-rose-100 bg-rose-50/40 px-4 py-3.5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-rose-900">Delete my account</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-rose-900/70">
                    Removes the account as well: no sign-in, no rows, no uploads, nothing left to
                    restore.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn shrink-0 !border-rose-200 !text-rose-700"
                  disabled={busy || typed.trim().toUpperCase() !== "DELETE"}
                  onClick={() => setAccountDialog(true)}
                >
                  <UserX className="h-4 w-4" /> Delete account
                </button>
              </div>
              <label className="mt-3 block">
                <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-rose-900/80">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                  Type DELETE to enable the button
                </span>
                <input
                  className="field max-w-[220px]"
                  value={typed}
                  onChange={(event) => setTyped(event.target.value)}
                  placeholder="DELETE"
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="Type DELETE to enable account deletion"
                />
              </label>
            </div>
          </div>
        </InteractiveCard>
      )}

      <ConfirmDialog
        open={dataDialog}
        onOpenChange={setDataDialog}
        onConfirm={() => void wipeData()}
        title="Delete all your data?"
        description="Transactions, scans, uploaded files and alert settings will be removed from the database. This cannot be undone. Your account and sign-in stay."
        confirmLabel="Yes, delete my data"
        cancelLabel="Keep my data"
        busy={busy}
        busyLabel="Deleting…"
        icon={Trash2}
      />

      <ConfirmDialog
        open={accountDialog}
        onOpenChange={setAccountDialog}
        onConfirm={() => void wipeAccount()}
        title="Delete your account?"
        description="Your rows, uploads and the account itself are removed. You will be signed out and this cannot be undone."
        confirmLabel="Delete everything"
        cancelLabel="Keep my account"
        busy={busy}
        busyLabel="Deleting…"
        icon={UserX}
      />
    </div>
  );
}
