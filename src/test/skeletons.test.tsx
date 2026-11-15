import { act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SKELETON_DELAY_MS, useSlowPending } from "@/lib/use-slow-pending";

import { SkeletonBlock, SkeletonCircle, SkeletonRegion, SkeletonText } from "@/components/Skeleton";
import { HistoryListSkeleton, HistoryTotalsSkeleton } from "@/components/skeletons/HistorySkeleton";
import { OverviewSkeleton } from "@/components/skeletons/OverviewSkeleton";
import { SettingsSkeleton } from "@/components/skeletons/SettingsSkeleton";

describe("skeleton primitives", () => {
  it("keeps decorative shapes out of the accessibility tree", () => {
    const { container } = render(
      <div>
        <SkeletonBlock className="h-4" />
        <SkeletonCircle />
        <SkeletonText lines={3} />
      </div>,
    );

    for (const shape of Array.from(container.querySelectorAll(".skeleton"))) {
      expect(shape.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("announces a region once, not once per shape", () => {
    render(
      <SkeletonRegion label="Loading your ledger">
        <SkeletonText lines={4} />
      </SkeletonRegion>,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Loading your ledger");
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("draws one bar per requested line, the last one shorter", () => {
    const { container } = render(<SkeletonText lines={3} />);
    const bars = Array.from(container.querySelectorAll(".skeleton"));

    expect(bars).toHaveLength(3);
    expect(bars.at(-1)?.className).toContain("w-2/3");
  });
});

describe("view skeletons", () => {
  it("marks every view skeleton busy with its own label", () => {
    render(
      <>
        <OverviewSkeleton />
        <HistoryTotalsSkeleton />
        <HistoryListSkeleton />
        <SettingsSkeleton />
      </>,
    );

    expect(screen.getByText("Loading your financial overview")).toBeInTheDocument();
    expect(screen.getByText("Loading ledger totals")).toBeInTheDocument();
    expect(screen.getByText("Loading transaction history")).toBeInTheDocument();
    expect(screen.getByText("Loading risk settings")).toBeInTheDocument();
  });

  it("keeps the overview chart body at the resolved height so the plot cannot shift", () => {
    const { container } = render(<OverviewSkeleton />);
    expect(container.querySelector(".h-\\[280px\\]")).toBeInTheDocument();
  });

  it("holds the settings action row while loading instead of showing real buttons", () => {
    render(<SettingsSkeleton />);
    expect(screen.queryByRole("button", { name: /save settings/i })).not.toBeInTheDocument();
  });
});

describe("useSlowPending", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("never shows a placeholder for a fast load", () => {
    const { result, rerender } = renderHook(({ pending }) => useSlowPending(pending), {
      initialProps: { pending: true },
    });

    act(() => void vi.advanceTimersByTime(SKELETON_DELAY_MS - 20));
    expect(result.current).toBe(false);

    // Data arrived before the threshold: the skeleton is never painted.
    rerender({ pending: false });
    act(() => void vi.advanceTimersByTime(1000));
    expect(result.current).toBe(false);
  });

  it("shows a placeholder once the wait is real", () => {
    const { result } = renderHook(() => useSlowPending(true));

    act(() => void vi.advanceTimersByTime(SKELETON_DELAY_MS + 10));
    expect(result.current).toBe(true);
  });

  it("hides it again as soon as the wait ends", () => {
    const { result, rerender } = renderHook(({ pending }) => useSlowPending(pending), {
      initialProps: { pending: true },
    });

    act(() => void vi.advanceTimersByTime(SKELETON_DELAY_MS + 10));
    expect(result.current).toBe(true);

    rerender({ pending: false });
    expect(result.current).toBe(false);
  });

  it("clears its timer on unmount", () => {
    const { unmount } = renderHook(() => useSlowPending(true));
    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });
});
