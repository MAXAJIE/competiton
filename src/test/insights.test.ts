import { describe, expect, it } from "vitest";
import {
  deltaVsBaseline,
  dueLabel,
  formatMonth,
  lateHistory,
  pct,
  severityChipClass,
  severityLabel,
  signedPct,
  topNStatement,
} from "@/lib/insights";

describe("insights presentation helpers", () => {
  it("renders probabilities as whole percentages", () => {
    expect(pct(0.6238)).toBe("62%");
    expect(pct(0)).toBe("0%");
    expect(pct(1)).toBe("100%");
  });

  it("signs deltas with a true minus and skips a useless baseline", () => {
    expect(signedPct(18.44)).toBe("+18.4%");
    expect(signedPct(-12.04)).toBe("−12.0%");
    expect(deltaVsBaseline(1200, 1000)).toBeCloseTo(20);
    expect(deltaVsBaseline(1200, 0)).toBeNull();
    expect(deltaVsBaseline(1200, null)).toBeNull();
  });

  it("labels the forecast month, and passes through anything unparseable", () => {
    expect(formatMonth("2026-12")).toBe("Dec 2026");
    expect(formatMonth(null)).toBe("—");
    expect(formatMonth("soon")).toBe("soon");
  });

  it("describes payment terms relative to today", () => {
    expect(dueLabel(-12)).toEqual({ text: "12d overdue", tone: "overdue" });
    expect(dueLabel(0)).toEqual({ text: "Due today", tone: "today" });
    expect(dueLabel(5)).toEqual({ text: "in 5d", tone: "soon" });
    expect(dueLabel(30)).toEqual({ text: "in 30d", tone: "later" });
  });

  it("turns a late rate and its sample size into plain words", () => {
    expect(lateHistory(0.4, 5)).toBe("2 of 5 late");
    expect(lateHistory(0.9, 10)).toBe("9 of 10 late");
    expect(lateHistory(0.2, 0)).toBe("no prior outcomes");
  });

  it("always pairs a severity colour with a label", () => {
    expect(severityLabel("high")).toBe("High");
    expect(severityLabel("medium")).toBe("Medium");
    expect(severityLabel("low")).toBe("Low");
    expect(severityChipClass("high")).toContain("rose");
    expect(severityChipClass("medium")).toContain("amber");
    expect(severityChipClass("low")).toContain("slate");
  });

  it("states how much of the book the risk queue shows", () => {
    expect(topNStatement(6, 9)).toBe("Top 6 of 9 open rows — money already late first, then predicted risk");
    expect(topNStatement(4, 4)).toBe("All 4 open rows — money already late first, then predicted risk");
    expect(topNStatement(1, 1)).toBe("The single open row, scored");
    expect(topNStatement(0, 0)).toBe("No open rows to score");
  });
});
