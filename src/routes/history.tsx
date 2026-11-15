import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  History as HistoryIcon,
  Search,
  SlidersHorizontal,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Headline, Page } from "@/components/Reveal";
import { ForcedEntrance } from "@/components/ForcedEntrance";
import { usd } from "@/lib/calc";
import {
  filterTransactions,
  type HistoryFilters,
  type HistoryPeriod,
  type HistorySort,
  type HistoryType,
} from "@/lib/history";
import { useStore } from "@/lib/store";
import type { Transaction, TxType } from "@/lib/types";

export const Route = createFileRoute("/history")({
  head: () => ({
    meta: [
      { title: "History — Cashflow" },
      {
        name: "description",
        content: "Review your complete income, expense, receivable, and payable history.",
      },
    ],
  }),
  component: HistoryPage,
});

const defaultFilters: HistoryFilters = {
  query: "",
  type: "all",
  period: "all",
  sort: "newest",
};

const typeOptions: { value: HistoryType; label: string }[] = [
  { value: "all", label: "All" },
  { value: "income", label: "Income" },
  { value: "expense", label: "Expense" },
  { value: "ar", label: "Receivable" },
  { value: "ap", label: "Payable" },
];

const periodOptions: { value: HistoryPeriod; label: string }[] = [
  { value: 3, label: "3 months" },
  { value: 6, label: "6 months" },
  { value: 12, label: "12 months" },
  { value: 24, label: "24 months" },
  { value: "all", label: "All time" },
];

const sortOptions: { value: HistorySort; label: string }[] = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "amount-desc", label: "Amount: high to low" },
  { value: "amount-asc", label: "Amount: low to high" },
  { value: "name-asc", label: "Name: A to Z" },
];

const typeLabels: Record<TxType, string> = {
  income: "Income",
  expense: "Expense",
  ar: "Receivable",
  ap: "Payable",
};
const zoomLabels = ["0.9×", "1×", "1.15×"] as const;

function transactionDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(
        date,
      );
}

function isIncoming(type: TxType) {
  return type === "income" || type === "ar";
}

function amountClass(type: TxType) {
  return isIncoming(type) ? "text-emerald-700" : "text-slate-700";
}

function statusClass(status: Transaction["status"]) {
  if (status === "paid") return "bg-emerald-50 text-emerald-700";
  if (status === "overdue") return "bg-rose-50 text-rose-700";
  return "bg-amber-50 text-amber-700";
}

function HistoryPage() {
  const { tx, loaded } = useStore();
  const [filters, setFilters] = useState(defaultFilters);
  const [draftFilters, setDraftFilters] = useState(defaultFilters);
  const [filterOpen, setFilterOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const drawerEl = useRef<HTMLDivElement | null>(null);
  const activeAnim = useRef<Animation | null>(null);
  const closing = useRef(false);

  const visibleTransactions = useMemo(() => filterTransactions(tx, filters), [tx, filters]);
  const totals = useMemo(
    () =>
      tx.reduce<Record<TxType, number>>(
        (sum, transaction) => {
          sum[transaction.type] += transaction.amount;
          return sum;
        },
        { income: 0, expense: 0, ar: 0, ap: 0 },
      ),
    [tx],
  );
  const activeFilterCount =
    Number(filters.type !== "all") +
    Number(filters.period !== "all") +
    Number(filters.sort !== "newest");
  const zoomClass = ["text-xs", "text-sm", "text-base"][zoom] ?? "text-sm";
  const rowPadding = ["py-2.5", "py-4", "py-5"][zoom] ?? "py-4";

  // Forced slide. Script-driven Web Animations outrank CSS animations and are
  // unaffected by the global `prefers-reduced-motion` reset, so the drawer always
  // slides — the CSS keyframes are only a fallback. Closing is intercepted here
  // so the exit animation plays before the dialog unmounts.
  const slide = useCallback(async (el: HTMLElement, entering: boolean) => {
    if (typeof el.animate !== "function") return;
    const horizontal = window.matchMedia("(min-width: 640px)").matches;
    const off = horizontal ? "translateX(100%)" : "translateY(100%)";
    const rest = "translate3d(0, 0, 0)";
    // Exactly one animation at a time: the mount callback and the open effect
    // can both fire for the same open, and a cancelled duplicate would otherwise
    // keep compositing the same property.
    activeAnim.current?.cancel();
    const anim = el.animate(
      entering ? [{ transform: off }, { transform: rest }] : [{ transform: rest }, { transform: off }],
      {
        duration: entering ? 400 : 300,
        easing: entering ? "cubic-bezier(0.22, 1, 0.36, 1)" : "cubic-bezier(0.4, 0, 0.2, 1)",
        fill: entering ? "backwards" : "forwards",
      },
    );
    activeAnim.current = anim;
    await anim.finished.catch(() => undefined);
  }, []);

  const animateIn = useCallback(() => {
    const el = drawerEl.current;
    if (el) void slide(el, true);
  }, [slide]);

  // Radix mounts the portal content *after* the effect pass, so a plain
  // useEffect would find a null ref and never animate. The callback ref fires
  // exactly when the node attaches, which is when the entrance must start.
  const setDrawerRef = useCallback(
    (node: HTMLDivElement | null) => {
      drawerEl.current = node;
      if (node) {
        closing.current = false;
        animateIn();
      }
    },
    [animateIn],
  );

  // Re-opening while the exit animation is still running: the node stayed
  // mounted, so the callback ref does not fire again.
  useEffect(() => {
    if (filterOpen) animateIn();
  }, [filterOpen, animateIn]);

  const openFilters = useCallback(
    (next: boolean) => {
      if (next) {
        setDraftFilters(filters);
        setFilterOpen(true);
        return;
      }
      const el = drawerEl.current;
      if (!el || closing.current) {
        setFilterOpen(false);
        return;
      }
      closing.current = true;
      void slide(el, false).then(() => {
        closing.current = false;
        setFilterOpen(false);
      });
    },
    [filters, slide],
  );

  return (
    <Page>
      <Headline eyebrow="Your ledger" lines={["Every entry,", "in one place."]} />

      <div
        className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
        data-reveal
      >
        <p className="text-sm text-slate-500" aria-live="polite">
          {loaded
            ? `${visibleTransactions.length} of ${tx.length} ${tx.length === 1 ? "entry" : "entries"}`
            : "Loading your ledger…"}
        </p>
        <Link to="/entry" className="btn btn-solid w-full justify-center sm:w-auto">
          Add transaction <ArrowRight aria-hidden className="h-4 w-4" />
        </Link>
      </div>

      <section aria-label="Ledger totals" className="mb-7 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {(
          [
            ["income", "Income recorded", "text-emerald-700", "bg-emerald-50"],
            ["expense", "Expenses recorded", "text-slate-700", "bg-slate-100"],
            ["ar", "Receivables", "text-sky-700", "bg-sky-50"],
            ["ap", "Payables", "text-amber-700", "bg-amber-50"],
          ] as const
        ).map(([type, label, color, background], index) => (
          <ForcedEntrance
            key={type}
            index={index}
            className="surface rounded-2xl border border-slate-200/80 bg-white p-4 sm:p-5"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-slate-500 sm:text-sm">{label}</p>
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-xl ${background} ${color}`}
              >
                {isIncoming(type) ? (
                  <ArrowUpRight aria-hidden className="h-4 w-4" />
                ) : (
                  <ArrowDownRight aria-hidden className="h-4 w-4" />
                )}
              </span>
            </div>
            <p className={`num mt-3 text-xl font-semibold tracking-tight sm:text-2xl ${color}`}>
              {usd(totals[type])}
            </p>
          </ForcedEntrance>
        ))}
      </section>

      <section
        className="surface overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-sm"
        aria-label="Transaction history"
      >
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:p-5 lg:flex-row lg:items-center">
          <label className="relative min-w-0 flex-1">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            />
            <span className="sr-only">Search by name, category, or amount</span>
            <input
              type="search"
              value={filters.query}
              onChange={(event) =>
                setFilters((current) => ({ ...current, query: event.target.value }))
              }
              placeholder="Search name or amount…"
              className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50/70 pl-10 pr-4 text-sm outline-none transition focus:border-indigo-300 focus:bg-white focus:ring-4 focus:ring-indigo-100"
            />
          </label>

          <div className="flex items-center gap-2">
            <div
              className="flex h-11 items-center rounded-xl border border-slate-200 bg-white p-1"
              aria-label="Adjust table text size"
            >
              <button
                type="button"
                aria-label="Zoom out"
                title="Zoom out"
                disabled={zoom === 0}
                onClick={() => setZoom((current) => Math.max(0, current - 1))}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-35"
              >
                <ZoomOut aria-hidden className="h-4 w-4" />
              </button>
              <span className="w-10 text-center text-xs tabular-nums text-slate-500">
                {zoomLabels[zoom]}
              </span>
              <button
                type="button"
                aria-label="Zoom in"
                title="Zoom in"
                disabled={zoom === 2}
                onClick={() => setZoom((current) => Math.min(2, current + 1))}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-35"
              >
                <ZoomIn aria-hidden className="h-4 w-4" />
              </button>
            </div>
            <button
              type="button"
              onClick={() => openFilters(true)}
              aria-haspopup="dialog"
              className="relative inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 sm:flex-none"
            >
              <SlidersHorizontal aria-hidden className="h-4 w-4" />
              Filters
              {activeFilterCount > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[#172641] px-1 text-[10px] font-semibold text-white">
                  {activeFilterCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {activeFilterCount > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3 sm:px-5">
            {filters.type !== "all" && (
              <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">
                {typeLabels[filters.type]}
              </span>
            )}
            {filters.period !== "all" && (
              <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">
                Last {filters.period} months
              </span>
            )}
            {filters.sort !== "newest" && (
              <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">
                {sortOptions.find((option) => option.value === filters.sort)?.label}
              </span>
            )}
          </div>
        )}

        {!loaded ? (
          <div className="space-y-3 p-5" aria-label="Loading transaction history" aria-busy="true">
            {[0, 1, 2, 3].map((item) => (
              <div key={item} className="h-14 animate-pulse rounded-xl bg-slate-100" />
            ))}
          </div>
        ) : visibleTransactions.length === 0 ? (
          <div className="px-5 py-16 text-center sm:py-20">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
              <HistoryIcon aria-hidden className="h-5 w-5" />
            </span>
            <h2 className="mt-4 text-lg font-semibold text-slate-800">
              {tx.length === 0 ? "No history yet" : "No matching entries"}
            </h2>
            <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-slate-500">
              {tx.length === 0
                ? "Once you record income, expenses, invoices, or bills, they’ll all appear here."
                : "Try another name or amount, or clear the filters to see more of your ledger."}
            </p>
            {tx.length === 0 ? (
              <Link to="/entry" className="btn btn-solid mt-5">
                Add your first transaction <ArrowRight aria-hidden className="h-4 w-4" />
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => setFilters(defaultFilters)}
                className="mt-5 text-sm font-semibold text-indigo-700 transition hover:text-indigo-900"
              >
                Clear search and filters
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full min-w-[720px] text-left">
                <thead className="bg-slate-50/80 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                  <tr>
                    <th scope="col" className={`px-5 ${rowPadding}`}>
                      Date
                    </th>
                    <th scope="col" className={`px-5 ${rowPadding}`}>
                      Name / category
                    </th>
                    <th scope="col" className={`px-5 ${rowPadding}`}>
                      Type
                    </th>
                    <th scope="col" className={`px-5 ${rowPadding}`}>
                      Status
                    </th>
                    <th scope="col" className={`px-5 text-right ${rowPadding}`}>
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visibleTransactions.map((transaction, index) => (
                    <tr
                      key={transaction.id}
                      className={`list-item-enter transition-colors hover:bg-slate-50/70 ${zoomClass}`}
                      style={{ animationDelay: `${Math.min(index, 12) * 25}ms` }}
                    >
                      <td className={`whitespace-nowrap px-5 ${rowPadding} text-slate-500`}>
                        {transactionDate(transaction.transaction_date)}
                      </td>
                      <td className={`max-w-[300px] px-5 ${rowPadding}`}>
                        <p className="truncate font-medium text-slate-800">
                          {transaction.vendor_or_customer || transaction.category}
                        </p>
                        <p className="mt-1 truncate text-xs text-slate-500">
                          {transaction.category}
                        </p>
                      </td>
                      <td className={`px-5 ${rowPadding}`}>
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                          {typeLabels[transaction.type]}
                        </span>
                      </td>
                      <td className={`px-5 ${rowPadding}`}>
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${statusClass(transaction.status)}`}
                        >
                          {transaction.status}
                        </span>
                      </td>
                      <td
                        className={`num whitespace-nowrap px-5 text-right font-semibold ${rowPadding} ${amountClass(transaction.type)}`}
                      >
                        {isIncoming(transaction.type) ? "+" : "−"}
                        {usd(transaction.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="divide-y divide-slate-100 sm:hidden">
              {visibleTransactions.map((transaction, index) => (
                <li
                  key={transaction.id}
                  className={`list-item-enter px-4 ${rowPadding}`}
                  style={{ animationDelay: `${Math.min(index, 12) * 25}ms` }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className={`truncate font-semibold text-slate-800 ${zoomClass}`}>
                        {transaction.vendor_or_customer || transaction.category}
                      </p>
                      <p className="mt-1 truncate text-xs text-slate-500">{transaction.category}</p>
                    </div>
                    <p
                      className={`num shrink-0 font-semibold ${zoomClass} ${amountClass(transaction.type)}`}
                    >
                      {isIncoming(transaction.type) ? "+" : "−"}
                      {usd(transaction.amount)}
                    </p>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                    <span className="inline-flex items-center gap-1.5 text-slate-500">
                      <CalendarDays aria-hidden className="h-3.5 w-3.5" />
                      {transactionDate(transaction.transaction_date)}
                    </span>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-600">
                      {typeLabels[transaction.type]}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-1 font-medium capitalize ${statusClass(transaction.status)}`}
                    >
                      {transaction.status}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <Dialog open={filterOpen} onOpenChange={openFilters}>
        <DialogContent
          ref={setDrawerRef}
          overlayClassName="filters-overlay bg-slate-900/35 backdrop-blur-[3px]"
          className="filters-drawer !fixed !bottom-0 !left-0 !right-0 !top-auto !w-full !max-w-none !translate-x-0 !translate-y-0 max-h-[90dvh] overflow-y-auto rounded-t-3xl border-slate-200 bg-white p-5 shadow-2xl sm:!bottom-0 sm:!left-auto sm:!right-0 sm:!top-0 sm:!h-full sm:!w-[430px] sm:!max-w-[430px] sm:rounded-none sm:rounded-l-3xl sm:p-7"
        >
          <div className="flex min-h-[min(78dvh,560px)] flex-col sm:min-h-full">
            <DialogHeader className="pr-10 text-left">
              <div className="flex items-center justify-between">
                <DialogTitle className="font-display text-2xl">Filter transactions</DialogTitle>
                <button
                  type="button"
                  onClick={() => setDraftFilters({ ...defaultFilters, query: filters.query })}
                  className="text-xs font-semibold text-slate-500 transition hover:text-indigo-700"
                >
                  Clear all
                </button>
              </div>
              <DialogDescription>
                Shape your history view without changing your ledger.
              </DialogDescription>
            </DialogHeader>

            <div className="min-h-0 flex-1 space-y-7 overflow-y-auto py-6">
              <label className="block">
                <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600">
                  Sort by
                </span>
                <select
                  value={draftFilters.sort}
                  onChange={(event) =>
                    setDraftFilters((current) => ({
                      ...current,
                      sort: event.target.value as HistorySort,
                    }))
                  }
                  className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
                >
                  {sortOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <fieldset>
                <legend className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600">
                  Transaction type
                </legend>
                <div className="flex flex-wrap gap-2">
                  {typeOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={draftFilters.type === option.value}
                      onClick={() =>
                        setDraftFilters((current) => ({ ...current, type: option.value }))
                      }
                      className={`rounded-full border px-3.5 py-2 text-xs font-medium transition ${
                        draftFilters.type === option.value
                          ? "border-[#172641] bg-[#172641] text-white shadow-sm"
                          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </fieldset>

              <fieldset>
                <legend className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600">
                  Time period
                </legend>
                <div className="flex flex-wrap gap-2">
                  {periodOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={draftFilters.period === option.value}
                      onClick={() =>
                        setDraftFilters((current) => ({ ...current, period: option.value }))
                      }
                      className={`rounded-full border px-3.5 py-2 text-xs font-medium transition ${
                        draftFilters.period === option.value
                          ? "border-[#172641] bg-[#172641] text-white shadow-sm"
                          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </fieldset>
            </div>

            <button
              type="button"
              onClick={() => {
                setFilters((current) => ({ ...current, ...draftFilters }));
                openFilters(false);
              }}
              className="flex h-12 shrink-0 items-center justify-center rounded-xl bg-[#082c4d] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#103b61] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sky-200"
            >
              Apply filters
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </Page>
  );
}
