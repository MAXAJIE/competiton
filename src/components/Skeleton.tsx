import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Skeleton primitives.
 *
 * Every shape is decorative (`aria-hidden`) and every region announces itself
 * through `SkeletonRegion`, so screen readers hear "Loading your ledger" once
 * instead of a pile of empty divs. Colours come from the theme tokens through
 * the `.skeleton` utility (see styles.css), which also owns the shimmer and its
 * `prefers-reduced-motion` fallback.
 */

/** A single shimmering block. Size it with h-/w- classes to match real content. */
export function SkeletonBlock({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={cn("skeleton", className)} {...props} />;
}

/** Circle for avatars and icon chips. */
export function SkeletonCircle({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <SkeletonBlock
      className={cn("shrink-0 rounded-full", className)}
      style={{ width: size, height: size }}
    />
  );
}

/** Stacked text lines; the final line is shorter so the block reads as prose. */
export function SkeletonText({
  lines = 2,
  className,
  lineClassName,
}: {
  lines?: number;
  className?: string;
  lineClassName?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: lines }, (_, index) => (
        <SkeletonBlock
          key={index}
          className={cn(
            "h-3 rounded-full",
            index === lines - 1 ? "w-2/3" : "w-full",
            lineClassName,
          )}
        />
      ))}
    </div>
  );
}

/**
 * Wraps a group of shapes: marks the area busy and gives assistive tech the one
 * sentence worth hearing while the real content is on its way.
 */
export function SkeletonRegion({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div aria-busy="true" className={className}>
      {children}
      <span className="sr-only" role="status">
        {label}
      </span>
    </div>
  );
}
