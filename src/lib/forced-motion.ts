// Forced entrance motion, driven by the Web Animations API.
//
// Why not CSS or GSAP:
//  - CSS keyframes are "suggestions": any !important rule wins, and this app's
//    global `@media (prefers-reduced-motion: reduce)` reset sets
//    `animation-duration: .01ms !important` on `*`, which silently removes every
//    entrance on machines that have OS animations switched off.
//  - GSAP sets inline styles from rAF and Reveal's timeline is skipped entirely
//    under reduced motion.
// Script-driven animations outrank both CSS animations and inline styles and are
// untouched by that media query, so this runs everywhere.
//
// The curve mirrors Reveal's widget entrance: alternating x offset, 3D tilt and
// a `back.out` overshoot, staggered by index.

const BACK_OUT = "cubic-bezier(0.34, 1.3, 0.64, 1)";

export function enterWidget(
  el: HTMLElement,
  index: number,
  options: { delay?: number; duration?: number } = {},
): Animation | undefined {
  if (typeof el.animate !== "function") return undefined;
  const x = index % 4 === 0 ? -34 : index % 4 === 1 ? 34 : index % 4 === 2 ? -26 : 26;
  const y = 24 + (index % 3) * 8;
  const rotateX = index % 2 === 0 ? 7 : -6;
  const rotateY = index % 4 === 0 ? -9 : index % 4 === 1 ? 8 : index % 4 === 2 ? -5 : 6;
  const rotateZ = index % 2 === 0 ? -2.5 : 2.5;
  const from = `perspective(1100px) translate3d(${x}px, ${y}px, 0) rotateX(${rotateX}deg) rotateY(${rotateY}deg) rotateZ(${rotateZ}deg)`;
  const to = "perspective(1100px) translate3d(0, 0, 0) rotateX(0deg) rotateY(0deg) rotateZ(0deg)";
  return el.animate(
    [
      { transform: from, opacity: 0 },
      { transform: to, opacity: 1 },
    ],
    {
      duration: options.duration ?? 780,
      // `backwards` holds the start state through the delay, so the card never
      // flashes at its final position before animating.
      delay: options.delay ?? 120 + index * 80,
      easing: BACK_OUT,
      fill: "backwards",
    },
  );
}
