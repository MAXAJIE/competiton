/**
 * Forced panel motion, shared so every overlay in the app feels the same.
 *
 * `slideTray` — the history filters drawer and anything else docked to an edge:
 * slides in from the right on >=640px, up from the bottom on phones.
 *
 * `popPanel` — centered dialogs (the sign-out confirmation): a quick, smooth
 * rise + scale + fade in place, so the panel appears mid-screen instead of
 * flying in from a side.
 *
 * Both are driven through the Web Animations API, which outranks CSS
 * animations and ignores the global `prefers-reduced-motion` reset — the CSS
 * keyframes in `styles.css` are the fallback when WAAPI is unavailable.
 */
export const TRAY_ENTER_MS = 400;
export const TRAY_EXIT_MS = 300;
export const POP_ENTER_MS = 260;
export const POP_EXIT_MS = 180;

const EASE_IN = "cubic-bezier(0.22, 1, 0.36, 1)"; // decelerate: smooth arrival
const EASE_OUT = "cubic-bezier(0.4, 0, 0.2, 1)"; // accelerate: quick departure
const EASE_POP = "cubic-bezier(0.16, 1, 0.3, 1)"; // confident, no overshoot

type ActiveAnim = { current: Animation | null };

export async function slideTray(
  el: HTMLElement,
  entering: boolean,
  active?: ActiveAnim,
): Promise<void> {
  // jsdom and very old browsers have no WAAPI: the CSS keyframes take over.
  if (typeof el.animate !== "function") return;

  const horizontal = window.matchMedia("(min-width: 640px)").matches;
  const off = horizontal ? "translateX(100%)" : "translateY(100%)";
  const rest = "translate3d(0, 0, 0)";

  await run(
    el,
    entering
      ? [{ transform: off }, { transform: rest }]
      : [{ transform: rest }, { transform: off }],
    entering ? TRAY_ENTER_MS : TRAY_EXIT_MS,
    entering ? EASE_IN : EASE_OUT,
    entering ? "backwards" : "forwards",
    active,
  );
}

export async function popPanel(
  el: HTMLElement,
  entering: boolean,
  active?: ActiveAnim,
): Promise<void> {
  if (typeof el.animate !== "function") return;

  const hidden = { opacity: 0, transform: "translateY(10px) scale(0.96)" };
  const shown = { opacity: 1, transform: "translateY(0px) scale(1)" };

  await run(
    el,
    entering ? [hidden, shown] : [shown, hidden],
    entering ? POP_ENTER_MS : POP_EXIT_MS,
    entering ? EASE_POP : EASE_OUT,
    entering ? "backwards" : "forwards",
    active,
  );
}

async function run(
  el: HTMLElement,
  keyframes: Keyframe[],
  duration: number,
  easing: string,
  fill: FillMode,
  active?: ActiveAnim,
) {
  // Exactly one animation at a time: the mount callback and the open effect can
  // both fire for the same open, and a cancelled duplicate would otherwise keep
  // compositing the same property.
  if (active) active.current?.cancel();

  const anim = el.animate(keyframes, { duration, easing, fill });
  if (active) active.current = anim;

  await anim.finished.catch(() => undefined);
}
