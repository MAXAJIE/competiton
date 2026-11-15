import { useRef, type ReactNode } from "react";
import { gsap, useGSAP } from "@/lib/motion";
/** Page entrance: masked headline lines + staggered [data-reveal] blocks + scroll-triggered [data-scroll]. */
export function Page({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const root = ref.current;
      if (!root) return;
      const ribbonViewBoxes = [
        "0 0 400 240",
        "-28 12 456 216",
        "0 -18 400 276",
        "-42 0 484 240",
        "18 0 364 240",
      ];
      const setRibbonMotion = (ribbon: SVGSVGElement, index: number) => {
        ribbon.setAttribute(
          "viewBox",
          ribbonViewBoxes[index % ribbonViewBoxes.length] ?? "0 0 400 240",
        );
        ribbon.querySelectorAll<SVGGElement>(".ribbon-wave").forEach((wave, layer) => {
          wave.setAttribute("data-motion", String((index * 2 + layer * 3) % 4));
        });
      };
      const motionReduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      // Content must never depend on a tween finishing. A hidden/frozen tab
      // pauses rAF, so a `from(opacity: 0)` stays at zero forever and the page
      // looks empty (this is what blanked the risk-settings cards). Two rules:
      // don't animate unless the document is actually visible, and finish any
      // tween we started as soon as it becomes visible again.
      const visible = () => document.visibilityState === "visible";
      const settle = (targets: gsap.TweenTarget) => {
        gsap.getTweensOf(targets).forEach((tween) => tween.progress(1, true));
        gsap.set(targets, { opacity: 1 });
      };
      const animated: HTMLElement[] = [];
      const onVisible = () => {
        if (visible()) animated.forEach((el) => settle(el));
      };
      // Returning to the tab finishes anything that stalled while it was hidden;
      // motion.ts also sweeps, in case no visibility event ever arrives.
      document.addEventListener("visibilitychange", onVisible);
      const ribbons = gsap.utils.toArray<SVGSVGElement>(".widget-ribbon", root);
      ribbons.forEach(setRibbonMotion);
      const lines = gsap.utils.toArray<HTMLElement>("[data-line] > span", root);
      const rules = gsap.utils.toArray<HTMLElement>("[data-rule]", root);
      const allWidgets = gsap.utils.toArray<HTMLElement>(".widget-surface", root);
      const widgets = allWidgets.filter(
        (el) => !el.closest("[data-scroll]") && !el.hasAttribute("data-local-entrance"),
      );
      const animatedWidgets = new WeakSet<HTMLElement>(allWidgets);
      const reveals = gsap.utils
        .toArray<HTMLElement>(
          "[data-reveal]:not([data-local-entrance]), .surface:not([data-reveal]):not([data-scroll]):not([data-local-entrance])",
          root,
        )
        .filter((el) => !el.closest("[data-scroll]") && !el.classList.contains("widget-surface"));
      if ((lines.length || rules.length || reveals.length || widgets.length) && visible()) {
        const tl = gsap.timeline({ defaults: { ease: "expo.out" } });
        if (!motionReduced()) {
          if (lines.length) {
            tl.from(lines, { yPercent: 60, opacity: 0, duration: 0.75, stagger: 0.07 });
          }
          if (rules.length) {
            tl.from(rules, { scaleX: 0, transformOrigin: "left", duration: 0.8 }, 0.08);
          }
          if (reveals.length) {
            tl.from(reveals, { y: 18, opacity: 0, duration: 0.55, stagger: 0.06 }, 0.18);
          }
        }
        animated.push(...lines, ...rules, ...reveals, ...widgets);
        if (widgets.length) {
          tl.fromTo(
            widgets,
            {
              x: (index) =>
                index % 4 === 0 ? -34 : index % 4 === 1 ? 34 : index % 4 === 2 ? -26 : 26,
              y: (index) => 24 + (index % 3) * 8,
              opacity: 0,
              rotationX: (index) => (index % 2 === 0 ? 7 : -6),
              rotationY: (index) =>
                index % 4 === 0 ? -9 : index % 4 === 1 ? 8 : index % 4 === 2 ? -5 : 6,
              rotationZ: (index) => (index % 2 === 0 ? -2.5 : 2.5),
              transformPerspective: 1100,
            },
            {
              x: 0,
              y: 0,
              opacity: 1,
              rotationX: 0,
              rotationY: 0,
              rotationZ: 0,
              transformPerspective: 1100,
              duration: 0.78,
              stagger: 0.09,
              ease: "back.out(1.15)",
            },
            0.18,
          );
        }
      }
      gsap.utils.toArray<HTMLElement>("[data-scroll]", root).forEach((el, index) => {
        const isWidget = el.classList.contains("widget-surface");
        if (motionReduced() && !isWidget) return;
        if (!visible()) return; // no scroll animation while hidden — nothing to rescue
        animated.push(el);
        gsap.from(el, {
          x: isWidget ? (index % 2 === 0 ? -28 : 28) : 0,
          y: isWidget ? 30 : 24,
          opacity: 0,
          rotationX: isWidget ? (index % 2 === 0 ? 6 : -5) : 0,
          rotationY: isWidget ? (index % 2 === 0 ? -7 : 7) : 0,
          rotationZ: isWidget ? (index % 2 === 0 ? -2 : 2) : 0,
          transformPerspective: isWidget ? 1100 : undefined,
          duration: 0.65,
          ease: "power3.out",
          scrollTrigger: { trigger: el, start: "top 90%" },
        });
      });

      let nextRibbonIndex = ribbons.length;
      let nextWidgetIndex = allWidgets.length;
      const observer = new MutationObserver((records) => {
        const addedWidgets = new Set<HTMLElement>();
        records.forEach((record) =>
          record.addedNodes.forEach((node) => {
            if (!(node instanceof Element)) return;
            if (node.matches(".widget-surface")) addedWidgets.add(node as HTMLElement);
            node
              .querySelectorAll<HTMLElement>(".widget-surface")
              .forEach((el) => addedWidgets.add(el));
          }),
        );
        addedWidgets.forEach((widget) => {
          if (animatedWidgets.has(widget)) return;
          animatedWidgets.add(widget);
          widget
            .querySelectorAll<SVGSVGElement>(".widget-ribbon")
            .forEach((ribbon) => setRibbonMotion(ribbon, nextRibbonIndex++));
          if (widget.hasAttribute("data-local-entrance")) return;
          // Mounted after the page reveal (e.g. after /api/settings resolves):
          // animate only if this tab can actually run the tween.
          if (!visible()) return;
          const index = nextWidgetIndex++;
          animated.push(widget);
          const isScrollWidget = Boolean(widget.closest("[data-scroll]"));
          gsap.fromTo(
            widget,
            {
              x: index % 4 === 0 ? -34 : index % 4 === 1 ? 34 : index % 4 === 2 ? -26 : 26,
              y: 24 + (index % 3) * 8,
              opacity: 0,
              rotationX: index % 2 === 0 ? 7 : -6,
              rotationY: index % 4 === 0 ? -9 : index % 4 === 1 ? 8 : index % 4 === 2 ? -5 : 6,
              rotationZ: index % 2 === 0 ? -2.5 : 2.5,
              transformPerspective: 1100,
            },
            {
              x: 0,
              y: 0,
              opacity: 1,
              rotationX: 0,
              rotationY: 0,
              rotationZ: 0,
              transformPerspective: 1100,
              duration: 0.78,
              delay: (index % 4) * 0.08,
              ease: "back.out(1.15)",
              ...(isScrollWidget ? { scrollTrigger: { trigger: widget, start: "top 90%" } } : {}),
            },
          );
        });
      });
      observer.observe(root, { childList: true, subtree: true });
      return () => {
        observer.disconnect();
        document.removeEventListener("visibilitychange", onVisible);
      };
    },
    { scope: ref },
  );
  return (
    <div
      ref={ref}
      className="mx-auto max-w-[1440px] px-4 pb-20 pt-6 sm:px-6 lg:px-10 lg:pb-16 lg:pt-10"
    >
      {children}
    </div>
  );
}
export function Headline({ eyebrow, lines }: { eyebrow: string; lines: string[] }) {
  return (
    <header className="mb-8 flex flex-col gap-5 sm:mb-10 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p
          className="eyebrow mb-3 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5"
          data-reveal
        >
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          {eyebrow}
        </p>
        <h1 className="max-w-3xl text-[2.65rem] leading-[0.98] tracking-tight sm:text-5xl lg:text-[3.6rem]">
          {lines.map((l, i) => (
            <span key={i} data-line className="block overflow-hidden pb-1">
              <span className={`block ${i === lines.length - 1 ? "italic text-accent" : ""}`}>
                {l}
              </span>
            </span>
          ))}
        </h1>
      </div>
      <div data-rule className="hidden h-px flex-1 self-center bg-border sm:ml-8 sm:block" />
    </header>
  );
}
