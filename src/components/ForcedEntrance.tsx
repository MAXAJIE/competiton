// A block that animates itself in with the widget entrance, via the Web
// Animations API (see lib/forced-motion.ts) — immune to CSS cascade fights and
// to the global prefers-reduced-motion reset.
//
// `data-local-entrance` opts the element out of Reveal's page-level timeline so
// two systems never animate the same node.
import { useEffect, useRef, type HTMLAttributes, type ReactNode } from "react";
import { enterWidget } from "@/lib/forced-motion";

type Props = HTMLAttributes<HTMLDivElement> & {
  index?: number;
  children: ReactNode;
};

export function ForcedEntrance({ index = 0, children, ...props }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const anim = enterWidget(el, index);
    return () => anim?.cancel();
  }, [index]);

  return (
    <div ref={ref} data-local-entrance="" {...props}>
      {children}
    </div>
  );
}
