import { useCallback, useEffect, useRef } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { popPanel } from "@/lib/panel-motion";
import { cn } from "@/lib/utils";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** Disables both buttons and swaps the confirm label (e.g. "Signing out…"). */
  busy?: boolean;
  busyLabel?: string;
  icon?: LucideIcon;
}

/**
 * A centered yes/no confirmation. It appears in the middle of the screen with a
 * short rise + scale + fade (lib/panel-motion#popPanel), so it never slides in
 * from a side. Escape and the backdrop route through the same animated close,
 * and the destructive action is only ever one deliberate click away.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  busy = false,
  busyLabel = "Working…",
  icon: Icon,
}: ConfirmDialogProps) {
  const panelEl = useRef<HTMLDivElement | null>(null);
  const closing = useRef(false);
  const activeAnim = useRef<Animation | null>(null);

  const animate = useCallback(
    (el: HTMLElement, entering: boolean) => popPanel(el, entering, activeAnim),
    [],
  );

  const animateIn = useCallback(() => {
    const el = panelEl.current;
    if (el) void animate(el, true);
  }, [animate]);

  // Radix mounts the portal content after the effect pass, so a plain useEffect
  // would find a null ref. The callback ref fires exactly when the node attaches.
  const setPanelRef = useCallback(
    (node: HTMLDivElement | null) => {
      panelEl.current = node;
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
    if (open) animateIn();
  }, [open, animateIn]);

  // Every close path (Cancel, Escape, backdrop) plays the exit before unmount.
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (next) {
        onOpenChange(true);
        return;
      }
      const el = panelEl.current;
      if (!el || closing.current) {
        onOpenChange(false);
        return;
      }
      closing.current = true;
      void animate(el, false).then(() => {
        closing.current = false;
        onOpenChange(false);
      });
    },
    [onOpenChange, animate],
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        // The wrapper only centers the card and clears Radix's own panel chrome —
        // the motion runs on the inner card so a transform never fights the
        // -50%/-50% centering.
        overlayClassName="tray-overlay bg-slate-900/35 backdrop-blur-[3px]"
        className="!fixed !left-1/2 !top-1/2 !w-[calc(100%-2rem)] !max-w-[420px] !-translate-x-1/2 !-translate-y-1/2 !animate-none !gap-0 !border-0 !bg-transparent !p-0 !shadow-none"
      >
        <div
          ref={setPanelRef}
          className="pop-panel rounded-3xl border border-slate-200 bg-white p-6 text-left shadow-[0_28px_80px_rgba(15,23,42,0.28)] sm:p-7"
        >
          <DialogHeader className="text-left">
            {Icon ? (
              <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-rose-50 text-rose-600">
                <Icon aria-hidden className="h-5 w-5" />
              </span>
            ) : null}
            <DialogTitle className="font-display text-xl leading-tight sm:text-2xl">
              {title}
            </DialogTitle>
            <DialogDescription className="lede mt-2">
              {description}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => handleOpenChange(false)}
              disabled={busy}
              className="flex h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-slate-200 disabled:opacity-60 sm:min-w-[7.5rem]"
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy}
              aria-busy={busy}
              className={cn(
                "flex h-11 items-center justify-center rounded-xl px-4 text-sm font-semibold text-white shadow-sm transition focus-visible:outline-none focus-visible:ring-4 sm:min-w-[9.5rem]",
                "bg-rose-600 hover:bg-rose-700 focus-visible:ring-rose-200",
                busy && "cursor-progress opacity-80",
              )}
            >
              {busy ? busyLabel : confirmLabel}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
