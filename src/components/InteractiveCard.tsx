import { useRef, type HTMLAttributes, type PointerEvent } from "react";
import { gsap, useGSAP } from "@/lib/motion";
import { WidgetRibbon } from "@/components/WidgetRibbon";

type Props = Omit<HTMLAttributes<HTMLDivElement>, "onPointerMove" | "onPointerLeave"> & {
  tilt?: number;
  ribbon?: boolean;
  animateOnMount?: boolean;
  entranceIndex?: number;
};

export function InteractiveCard({
  className = "",
  children,
  tilt = 2.5,
  ribbon = true,
  animateOnMount = false,
  entranceIndex = 0,
  ...props
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const rotateX = useRef<((value: number) => void) | null>(null);
  const rotateY = useRef<((value: number) => void) | null>(null);

  useGSAP(
    () => {
      const card = ref.current;
      if (!card) return;
      gsap.set(card, { transformPerspective: 900, transformStyle: "preserve-3d" });
      if (animateOnMount) {
        gsap.fromTo(
          card,
          {
            x: entranceIndex % 4 === 0 ? -34 : entranceIndex % 4 === 1 ? 34 : -26,
            y: 24 + (entranceIndex % 3) * 8,
            opacity: 0,
            rotationX: entranceIndex % 2 === 0 ? 7 : -6,
            rotationY: entranceIndex % 2 === 0 ? -8 : 8,
            rotationZ: entranceIndex % 2 === 0 ? -2.5 : 2.5,
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
            delay: Math.min(entranceIndex, 4) * 0.07,
            ease: "back.out(1.15)",
          },
        );
      }
      if (card.dataset["entrance"] === "launcher") {
        gsap.from(card, {
          x: 22,
          y: 20,
          opacity: 0,
          rotationX: 9,
          rotationY: -10,
          rotationZ: 6,
          scale: 0.86,
          duration: 0.72,
          delay: 0.18,
          ease: "back.out(1.25)",
        });
      }
      if (tilt <= 0) return;
      rotateX.current = gsap.quickTo(card, "rotationX", {
        duration: 0.4,
        ease: "power3.out",
      });
      rotateY.current = gsap.quickTo(card, "rotationY", {
        duration: 0.4,
        ease: "power3.out",
      });
      return () => {
        gsap.killTweensOf(card);
        rotateX.current = null;
        rotateY.current = null;
      };
    },
    { scope: ref, dependencies: [tilt, animateOnMount, entranceIndex] },
  );

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const card = ref.current;
    if (!card) return;
    const bounds = card.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const x = (event.clientX - bounds.left) / bounds.width;
    const y = (event.clientY - bounds.top) / bounds.height;
    if (event.pointerType !== "mouse" || tilt <= 0) return;
    rotateX.current?.((0.5 - y) * tilt);
    rotateY.current?.((x - 0.5) * tilt);
  };

  const onPointerLeave = () => {
    rotateX.current?.(0);
    rotateY.current?.(0);
  };

  return (
    <div
      {...props}
      ref={ref}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      data-local-entrance={animateOnMount ? "" : undefined}
      className={`widget-surface ${className}`}
    >
      {ribbon && <WidgetRibbon />}
      {children}
    </div>
  );
}
