import { useEffect, useState } from "react";

/** A wait shorter than this never shows a placeholder: no flash on fast loads. */
export const SKELETON_DELAY_MS = 150;

/**
 * Delays placeholders until a wait is real.
 *
 * Returns `true` only once `pending` has lasted longer than `threshold`; a load
 * that finishes quickly resolves straight to content and the skeleton is never
 * painted. The timer is cleared whenever the wait ends or the component
 * unmounts, so nothing fires after the fact.
 */
export function useSlowPending(pending: boolean, threshold = SKELETON_DELAY_MS): boolean {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (!pending) {
      setSlow(false);
      return;
    }
    const timer = window.setTimeout(() => setSlow(true), threshold);
    return () => window.clearTimeout(timer);
  }, [pending, threshold]);

  return pending && slow;
}
