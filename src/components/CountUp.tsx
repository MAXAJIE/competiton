import { useRef } from "react";
import { gsap, useGSAP } from "@/lib/motion";
export function CountUp({ value, format, delay = 0.3 }: { value: number; format: (n: number) => string; delay?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useGSAP(() => {
    const o = { v: 0 };
    gsap.to(o, { v: value, duration: 1.8, delay, ease: "power4.out", onUpdate: () => { if (ref.current) ref.current.textContent = format(o.v); } });
  }, { dependencies: [value] });
  return <span ref={ref} className="num">{format(value)}</span>;
}
