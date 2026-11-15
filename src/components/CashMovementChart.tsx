// The dashboard's cash-movement panel: income vs expenses per month.
//
// Three states, and the rule behind them: never hide a figure that exists.
//   * no months            → an empty frame with a way in (nothing invented)
//   * exactly one month    → two bars for that month, not a "come back later"
//                            placeholder: the owner's expenses are in there
//   * two or more months   → the trend, with empty months drawn as zero
//
// The series itself comes from `calc.getMonthlySeries` (gap-filled, last 12
// months). Nothing here recomputes money — it only formats what calc returned.
import { Link } from "@tanstack/react-router";
import { ArrowRight, Clock3 } from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { usd } from "@/lib/calc";

export type MonthlyPoint = { month: string; income: number; expense: number };

const INCOME_COLOR = "#4968e8";
const EXPENSE_COLOR = "#22a58b";

const shortMonth = (value: string) =>
  new Date(`${value}-01T12:00:00`).toLocaleDateString("en-US", { month: "short" });

const longMonth = (value: string) =>
  new Date(`${value}-01T12:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });

const axisUsd = (value: number) => (value >= 1000 ? `$${Math.round(value / 1000)}k` : `$${value}`);

// Recharts passes the bar's `name` through; keep one label rule for both charts.
const seriesLabel = (name: unknown) =>
  String(name).toLowerCase() === "income" ? "Income" : "Expenses";

const axis = {
  axisLine: false,
  tickLine: false,
  tick: { fill: "#64748b", fontSize: 11 },
} as const;

const tooltip = {
  cursor: { stroke: "#d9dfeb", strokeDasharray: "4 4" },
  contentStyle: {
    border: "1px solid #e3e8f0",
    borderRadius: 14,
    boxShadow: "0 10px 24px rgba(22,37,63,.10)",
    fontSize: 12,
  },
  labelFormatter: longMonth,
  formatter: (value: unknown, name: unknown) =>
    [usd(Number(value)), seriesLabel(name)] as [string, string],
} as const;

function EmptyState() {
  return (
    <div className="mt-6 flex h-[280px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-6 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-slate-500 shadow-sm">
        <Clock3 className="h-5 w-5" />
      </span>
      <p className="mt-3 font-semibold text-slate-800">Your cash story starts here</p>
      <p className="mt-1 max-w-sm lede">
        Once you record transactions, monthly cash movement will appear here.
      </p>
      <Link
        to="/entry"
        className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline"
      >
        Add a transaction <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
}

export function CashMovementChart({
  data,
  reduceMotion = false,
}: {
  data: MonthlyPoint[];
  reduceMotion?: boolean;
}) {
  if (data.length === 0) return <EmptyState />;

  // One month is data, not a waiting room: show income against expenses for it
  // and say plainly that the trend needs a second month.
  if (data.length === 1) {
    const only = data[0]!;
    const net = only.income - only.expense;
    return (
      <div className="mt-6">
        <div
          className="h-[248px] w-full"
          aria-label={`Income and expenses for ${longMonth(only.month)}`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 6, left: -16, bottom: 0 }} barGap={16}>
              <CartesianGrid vertical={false} stroke="#edf0f5" strokeDasharray="4 5" />
              <XAxis dataKey="month" tickFormatter={shortMonth} dy={10} {...axis} />
              <YAxis tickFormatter={axisUsd} width={52} {...axis} />
              <Tooltip {...tooltip} />
              <Bar
                dataKey="income"
                name="Income"
                fill={INCOME_COLOR}
                radius={[8, 8, 0, 0]}
                maxBarSize={96}
                isAnimationActive={!reduceMotion}
              />
              <Bar
                dataKey="expense"
                name="Expenses"
                fill={EXPENSE_COLOR}
                radius={[8, 8, 0, 0]}
                maxBarSize={96}
                isAnimationActive={!reduceMotion}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-slate-600">
          <p>
            <span className="font-semibold text-slate-800">{longMonth(only.month)}</span>
            {" · "}income {usd(only.income)}
            {" · "}expenses {usd(only.expense)}
            {" · "}net {net < 0 ? "-" : ""}
            {usd(Math.abs(net))}
          </p>
          <p className="text-muted-foreground">
            One month recorded — add another month of activity to reveal the trend.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6 h-[280px] w-full" aria-label="Monthly income and expense chart">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 6, left: -16, bottom: 0 }}>
          <defs>
            <linearGradient id="incomeFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={INCOME_COLOR} stopOpacity={0.18} />
              <stop offset="95%" stopColor={INCOME_COLOR} stopOpacity={0} />
            </linearGradient>
            <linearGradient id="expenseFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={EXPENSE_COLOR} stopOpacity={0.14} />
              <stop offset="95%" stopColor={EXPENSE_COLOR} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="#edf0f5" strokeDasharray="4 5" />
          <XAxis dataKey="month" tickFormatter={shortMonth} dy={10} {...axis} />
          <YAxis tickFormatter={axisUsd} width={52} {...axis} />
          <Tooltip {...tooltip} />
          <Area
            type="monotone"
            dataKey="income"
            stroke={INCOME_COLOR}
            strokeWidth={2.5}
            fill="url(#incomeFill)"
            activeDot={{ r: 5, strokeWidth: 0 }}
            isAnimationActive={!reduceMotion}
            animationDuration={800}
          />
          <Area
            type="monotone"
            dataKey="expense"
            stroke={EXPENSE_COLOR}
            strokeWidth={2}
            fill="url(#expenseFill)"
            activeDot={{ r: 4, strokeWidth: 0 }}
            isAnimationActive={!reduceMotion}
            animationDuration={800}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
