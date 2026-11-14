import { useRef, type ReactNode } from "react";
import { gsap, useGSAP } from "@/lib/motion";
/** Page entrance: masked headline lines + staggered [data-reveal] blocks + scroll-triggered [data-scroll]. */
export function Page({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    const tl = gsap.timeline({ defaults: { ease: "expo.out" } });
    tl.from("[data-line] > span", { yPercent: 110, duration: 1.1, stagger: 0.08 })
      .from("[data-rule]", { scaleX: 0, transformOrigin: "left", duration: 1.2 }, 0.1)
      .from("[data-reveal]", { y: 40, opacity: 0, duration: 0.9, stagger: 0.07 }, 0.25);
    gsap.utils.toArray<HTMLElement>("[data-scroll]").forEach(el =>
      gsap.from(el, { y: 60, opacity: 0, duration: 1, ease: "power3.out", scrollTrigger: { trigger: el, start: "top 88%" } }));
  }, { scope: ref });
  return <div ref={ref} className="mx-auto max-w-6xl px-6 pb-24 pt-10">{children}</div>;
}
export function Headline({ eyebrow, lines }: { eyebrow: string; lines: string[] }) {
  return (
    <header className="mb-10">
      <p className="eyebrow mb-4" data-reveal>{eyebrow}</p>
      <h1 className="text-5xl leading-[0.95] md:text-7xl">
        {lines.map((l, i) => <span key={i} data-line className="block overflow-hidden pb-1"><span className={`block ${i === lines.length - 1 ? "italic text-accent" : ""}`}>{l}</span></span>)}
      </h1>
      <div data-rule className="rule mt-8" />
    </header>
  );
}
