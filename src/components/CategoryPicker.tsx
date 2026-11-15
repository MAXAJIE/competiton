// Animated category combobox. Suggestions come from the backend taxonomy
// (GET /api/categories, via useCategories) with the bundled fallback, so the
// list can never drift from what the classifier and OCR produce. The list is
// scoped to the current ledger type, so an Expense never suggests an AR payout.
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { Check, ChevronDown, Search, Sparkles } from "lucide-react";
import { categoriesFor, useCategories } from "@/lib/categories";
import type { TxType } from "@/lib/types";

type Props = {
  value: string;
  onChange: (label: string) => void;
  type: TxType;
  disabled?: boolean;
  suggested?: string | null;
};

export function CategoryPicker({
  value,
  onChange,
  type,
  disabled = false,
  suggested = null,
}: Props) {
  const tax = useCategories();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [placement, setPlacement] = useState<"below" | "above">("below");
  const listboxId = useId();

  const groups = useMemo(() => categoriesFor(tax, type), [tax, type]);
  const all = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const selected = useMemo(() => all.find((item) => item.label === value) ?? null, [all, value]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.group.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q),
    );
  }, [all, query]);

  // Re-project the groups with each item's index into `matches`, so arrow keys
  // walk the visible list in the same order the eye sees it.
  const sections = useMemo(() => {
    let index = 0;
    return groups
      .map((group) => ({
        group: group.group,
        items: group.items
          .filter((item) => matches.includes(item))
          .map((item) => ({ category: item, index: index++ })),
      }))
      .filter((section) => section.items.length > 0);
  }, [groups, matches]);

  // Keep the panel mounted through its exit animation.
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    if (!mounted) return;
    const timer = window.setTimeout(() => setMounted(false), 150);
    return () => window.clearTimeout(timer);
  }, [open, mounted]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    // The entry form is long: open upward when there is no room below, so the
    // panel is never clipped by the bottom of the viewport.
    const trigger = rootRef.current?.querySelector("button");
    if (trigger) {
      const rect = trigger.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      setPlacement(spaceBelow < 340 && rect.top > spaceBelow ? "above" : "below");
    }
    const timer = window.setTimeout(() => searchRef.current?.focus(), 30);
    return () => window.clearTimeout(timer);
  }, [open, type]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const pick = (label: string) => {
    onChange(label);
    setOpen(false);
    setQuery("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) setOpen(true);
      else setActive((current) => Math.min(matches.length - 1, current + 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => Math.max(0, current - 1));
      return;
    }
    if (event.key === "Enter") {
      if (!open) return;
      event.preventDefault();
      const chosen = matches[active];
      if (chosen) pick(chosen.label);
      else if (query.trim()) pick(query.trim());
      return;
    }
    if (event.key === "Tab") setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={onKeyDown}
        className="field flex w-full items-center justify-between gap-2 text-left disabled:opacity-60"
      >
        <span className={`truncate ${value ? "text-slate-800" : "text-slate-400"}`}>
          {value || "Choose a category…"}
        </span>
        <ChevronDown
          aria-hidden
          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {selected && (
        <span className="mt-1.5 block text-xs leading-relaxed text-muted-foreground">
          {selected.description}
        </span>
      )}

      {suggested && suggested !== value && (
        <button
          type="button"
          onClick={() => pick(suggested)}
          className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] font-medium text-indigo-700 transition hover:bg-indigo-100"
        >
          <Sparkles aria-hidden className="h-3 w-3" />
          Suggested: {suggested}
        </button>
      )}

      {mounted && (
        <div
          data-state={open ? "open" : "closed"}
          style={{ transformOrigin: placement === "above" ? "bottom center" : "top center" }}
          className={`cat-panel absolute left-0 right-0 z-30 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_18px_44px_rgba(22,37,63,0.16)] ${
            placement === "above" ? "bottom-[calc(100%+0.4rem)]" : "top-[calc(100%+0.4rem)]"
          }`}
        >
          <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
            <Search aria-hidden className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
              placeholder="Search categories…"
              aria-label="Search categories"
              aria-controls={listboxId}
              aria-activedescendant={matches[active] ? `${listboxId}-opt-${active}` : undefined}
              className="h-7 w-full min-w-0 bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
            />
          </div>

          <ul id={listboxId} role="listbox" aria-label="Categories" className="max-h-64 overflow-y-auto py-1">
            {sections.map((section) => (
              <li key={section.group} role="presentation">
                <p className="eyebrow px-3 pb-1 pt-2.5 text-[0.6rem]">{section.group}</p>
                <ul role="group" aria-label={section.group}>
                  {section.items.map(({ category, index }) => {
                    const isSelected = category.label === value;
                    const isActive = index === active;
                    return (
                      <li key={category.key} role="presentation">
                        <button
                          type="button"
                          role="option"
                          id={`${listboxId}-opt-${index}`}
                          aria-selected={isSelected}
                          onMouseEnter={() => setActive(index)}
                          onClick={() => pick(category.label)}
                          style={{ "--cat-delay": `${Math.min(index, 10) * 14}ms` } as CSSProperties}
                          className={`cat-option flex w-full items-start justify-between gap-2 px-3 py-2 text-left transition-colors ${
                            isActive ? "bg-indigo-50/80" : "bg-transparent"
                          }`}
                        >
                          <span className="min-w-0">
                            <span className="flex items-center gap-1.5">
                              <span
                                className={`truncate text-sm ${
                                  isSelected ? "font-semibold text-indigo-800" : "text-slate-700"
                                }`}
                              >
                                {category.label}
                              </span>
                              {suggested === category.label && (
                                <Sparkles aria-hidden className="h-3 w-3 shrink-0 text-indigo-500" />
                              )}
                            </span>
                            <span className="mt-0.5 block truncate text-[11px] text-slate-400">
                              {category.description}
                            </span>
                          </span>
                          {isSelected && (
                            <Check aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" />
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}

            {query.trim() && !matches.some((item) => item.label === query.trim()) && (
              <li role="presentation" className="border-t border-slate-100 pt-1">
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => pick(query.trim())}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-600 transition-colors hover:bg-slate-50"
                >
                  Use “{query.trim()}”
                </button>
              </li>
            )}

            {sections.length === 0 && !query.trim() && (
              <li role="presentation" className="px-3 py-4 text-center text-xs text-slate-500">
                No categories available yet.
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
