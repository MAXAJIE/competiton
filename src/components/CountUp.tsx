import { useRef } from "react";
import { gsap, useGSAP } from "@/lib/motion";
export function CountUp({
  value,
  format,
  delay = 0.3,
  className = "tabular-nums",
}: {
  value: number;
  format: (n: number) => string;
  delay?: number;
  /** Digits come from the surrounding figure; tabular by default so they align. */
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useGSAP(
    () => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        if (ref.current) ref.current.textContent = format(value);
        return;
      }
      const o = { v: 0 };
      gsap.to(o, {
        v: value,
        duration: 1.8,
        delay,
        ease: "power4.out",
        onUpdate: () => {
          if (ref.current) ref.current.textContent = format(o.v);
        },
      });
    },
    { dependencies: [value] },
  );
  return (
    <span ref={ref} className={className}>
      {format(value)}
    </span>
  );
}
