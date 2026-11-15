import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
if (typeof window !== "undefined") gsap.registerPlugin(ScrollTrigger, useGSAP);

// A reveal animation is a `from(opacity: 0)` tween. If that tween ever fails to
// advance — a background or frozen tab pauses rAF, a route change kills it
// mid-flight — the element keeps the inline `opacity: 0` it was given and the
// section is permanently blank (this is what hid the risk-settings cards).
//
// Content must not depend on an animation finishing, so sweep the elements we
// animate and release any that are invisible with no tween driving them. The
// check is deliberately narrow: only GSAP-authored selectors, only when nothing
// is animating, and only when the element is actually stuck at zero.
const REVEAL_SELECTOR = "[data-reveal], .surface, .widget-surface, [data-scroll]";

function releaseStrandedReveals() {
  if (typeof document === "undefined") return;
  document.querySelectorAll<HTMLElement>(REVEAL_SELECTOR).forEach((el) => {
    if (el.style.opacity !== "0") return;
    if (gsap.getTweensOf(el).some((tween) => tween.isActive())) return;
    el.style.removeProperty("opacity");
  });
}

if (typeof window !== "undefined") {
  // rAF is paused in a hidden tab; timers are not. Sweep on a timer, on return
  // to the tab, and once after load.
  window.setInterval(releaseStrandedReveals, 2000);
  document.addEventListener("visibilitychange", releaseStrandedReveals);
  window.addEventListener("load", () => window.setTimeout(releaseStrandedReveals, 1200));
}

export { gsap, ScrollTrigger, useGSAP, releaseStrandedReveals };
