"""Compartment B2 — tool-calling advisor (SKILL.md §3 anti-hallucination gate).

Structural guarantee: every figure in the reply comes from a named calc-layer
function executed at answer time. If the LLM calls no tool, the reply is the
standard refusal — there is no path to figures without a tool result. Market
context is passed to the model as labeled qualitative color only and never
attached to a figure.
"""
from __future__ import annotations

import json
from datetime import date

import httpx

from . import calc, config
from .models import AdvisorReply, Figure, Transaction, RiskSettings

TOOL_SET = [
    {"type": "function", "function": {
        "name": "analyze_cash_flow",
        "description": "Cash balance, average monthly burn, and runway in months. Use for any cash/runway/flow/analysis question.",
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "ar_ap_summary",
        "description": "Open receivables and payables totals, overdue AR, and aging buckets.",
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "generate_financial_statement",
        "description": "Income statement for a date range. Default: trailing 12 months if none given.",
        "parameters": {"type": "object", "properties": {"months": {"type": "integer", "description": "Length of the period in months, default 12"}}},
    }},
    {"type": "function", "function": {
        "name": "predict_next_month_revenue",
        "description": "Simple documented projection of next month's revenue (trailing 3-month average). Use for predict/forecast questions.",
        "parameters": {"type": "object", "properties": {}},
    }},
]

REFUSAL = ("I don't have a tool that can answer that, so I won't guess. "
           "I can analyze cash flow, summarize AR/AP, generate a statement, "
           "or predict next month's revenue.")

NO_DATA = ("There are no transactions recorded yet, so there is nothing to "
           "calculate. Add an entry (manual or scanned) and ask me again — "
           "I won't invent figures.")

SYSTEM_PROMPT = (
    "You are a private cash-flow advisor for a small business owner. You answer "
    "ONLY through the provided tools — every number you mention must come from a "
    "tool result in this conversation; never compute or recall figures yourself. "
    "If no tool fits the question, say you can't answer it. The revenue prediction "
    "uses a documented simple method — always state the method in your answer and "
    "note it is a projection, not a guarantee. Market context you receive is "
    "general qualitative color, not a regime signal — mention it only in prose, "
    "clearly separated from computed figures, and never let it change a number. "
    "Keep answers short and concrete."
)


def _run_tool(name: str, args: dict, tx: list[Transaction]) -> tuple[dict, list[Figure]]:
    """Execute a named calc function over real transaction rows (§3: figures
    are only ever attached here)."""
    if name == "analyze_cash_flow":
        bal = calc.get_cash_balance(tx)
        runway = calc.get_runway_months(tx)
        figures = [Figure(label="Cash balance", value=calc.usd(bal))]
        if runway is not None:
            figures.append(Figure(label="Runway", value=f"{runway:.1f} months"))
        return ({"cash_balance": bal, "avg_monthly_burn": calc.get_avg_monthly_burn(tx),
                 "runway_months": runway}, figures)
    if name == "ar_ap_summary":
        a = calc.get_ar_ap_summary(tx)
        return (a, [Figure(label="Open AR", value=calc.usd(a["ar"])),
                    Figure(label="Overdue AR", value=calc.usd(a["arOverdue"])),
                    Figure(label="Open AP", value=calc.usd(a["ap"]))])
    if name == "generate_financial_statement":
        s = calc.generate_financial_statement(tx, months=int(args.get("months") or 12))
        return (s, [Figure(label="Total income", value=calc.usd(s["total_income"])),
                    Figure(label="Total expenses", value=calc.usd(s["total_expense"])),
                    Figure(label="Net profit", value=calc.usd(s["net"]))])
    if name == "predict_next_month_revenue":
        p = calc.predict_next_month_revenue(tx)
        return (p, [Figure(label="Projected revenue", value=calc.usd(p["value"]))])
    raise KeyError(name)


def _market_context() -> str:
    from . import db
    try:
        snap = db.latest_market_snapshot()
    except Exception:
        return ""  # qualitative color only — never fail the answer over it
    if not snap:
        return ""
    ind = snap.get("indicators_json") or []
    heads = snap.get("headlines_json") or []
    lines = [f"{i.get('k')}: {i.get('v')} ({i.get('d')})" for i in ind]
    return ("\n\nGeneral market context (qualitative color only, cached, not a "
            "regime signal, not an input to any number):\n" +
            "\n".join(f"- {l}" for l in lines) +
            ("\nRecent headlines:\n" + "\n".join(f"- {h}" for h in heads[:3]) if heads else ""))


def _deterministic_answer(q: str, tx: list[Transaction],
                          settings: RiskSettings | None = None) -> AdvisorReply:
    """Fallback when no OpenRouter key is configured (dev/demo on flaky wifi):
    same four tools, same refusal rule, no LLM involved."""
    s = q.lower()
    if any(k in s for k in ("predict", "forecast", "next month")):
        p = calc.predict_next_month_revenue(tx)
        return AdvisorReply(tool="predict_next_month_revenue",
                            text=(f"Projected revenue for next month is shown below. "
                                  f"Method: {p['method']}. It is a simple projection, "
                                  f"not a guarantee."),
                            figures=[Figure(label="Projected revenue", value=calc.usd(p["value"]))])
    if any(k in s for k in ("ar", "ap", "receivable", "payable", "owe")):
        a = calc.get_ar_ap_summary(tx)
        return AdvisorReply(tool="ar_ap_summary",
                            text="Open receivables and payables, from your recorded invoices and bills.",
                            figures=[Figure(label="Open AR", value=calc.usd(a["ar"])),
                                     Figure(label="Overdue AR", value=calc.usd(a["arOverdue"])),
                                     Figure(label="Open AP", value=calc.usd(a["ap"]))])
    if any(k in s for k in ("cash", "runway", "flow", "analy")):
        runway = calc.get_runway_months(tx)
        text = "Your cash balance and runway are shown below. Collecting overdue receivables is the fastest lever."
        if runway is not None and settings and settings.enabled and runway < settings.low_cash_threshold_months:
            text = (f"Your runway is below your own warning threshold of "
                    f"{settings.low_cash_threshold_months:g} months. "
                    "Collecting overdue receivables is the fastest lever.")
        figs = [Figure(label="Cash balance", value=calc.usd(calc.get_cash_balance(tx)))]
        if runway is not None:
            figs.append(Figure(label="Runway", value=f"{runway:.1f} months"))
        return AdvisorReply(tool="analyze_cash_flow", text=text, figures=figs)
    if any(k in s for k in ("statement", "p&l", "profit")):
        st = calc.generate_financial_statement(tx)
        return AdvisorReply(tool="generate_financial_statement",
                            text=(f"Income statement for {st['period_start']} to "
                                  f"{st['period_end']} is ready."),
                            figures=[Figure(label="Total income", value=calc.usd(st["total_income"])),
                                     Figure(label="Total expenses", value=calc.usd(st["total_expense"])),
                                     Figure(label="Net profit", value=calc.usd(st["net"]))])
    return AdvisorReply(text=REFUSAL)


def _complete(messages: list[dict]) -> dict | None:
    """One chat completion, walking the model fallback chain on provider errors."""
    last_error = ""
    for model in config.ADVISOR_MODELS:
        try:
            r = httpx.post(
                f"{config.OPENROUTER_BASE}/chat/completions",
                headers={"Authorization": f"Bearer {config.OPENROUTER_API_KEY}",
                         "HTTP-Referer": "https://cashmonitoring.app",
                         "X-Title": "CashMonitoring Advisor"},
                json={"model": model, "messages": messages, "tools": TOOL_SET,
                      "tool_choice": "auto", "max_tokens": 700, "temperature": 0.2},
                timeout=120,
            )
            if r.status_code != 200:
                last_error = f"{model} → HTTP {r.status_code}"
                continue
            return r.json()["choices"][0]["message"]
        except Exception as e:
            last_error = f"{model} → {e}"
    print(f"advisor: no model reachable ({last_error})")
    return None


def ask(question: str, tx: list[Transaction], settings: RiskSettings | None = None) -> AdvisorReply:
    if not tx:
        # Nothing recorded yet: say so rather than computing over an empty set.
        return AdvisorReply(text=NO_DATA)
    if not config.OPENROUTER_API_KEY:
        return _deterministic_answer(question, tx, settings)

    def to_llm(t: Transaction) -> dict:
        return t.model_dump(exclude_none=True)

    messages: list[dict] = [
        {"role": "system", "content": SYSTEM_PROMPT + _market_context()},
        {"role": "user", "content": question + "\n\nYour only data source is the "
             f"transactions passed to the tools ({len(tx)} rows): " +
             json.dumps([to_llm(t) for t in tx])},
    ]

    called_tools: list[str] = []
    figures: list[Figure] = []
    for _ in range(3):
        msg = _complete(messages)
        if msg is None:
            return AdvisorReply(text="The advisor is unavailable right now (no model reachable). Nothing was guessed.")
        tool_calls = msg.get("tool_calls") or []
        if not tool_calls:
            if called_tools:
                return AdvisorReply(text=msg.get("content") or "", tool=called_tools[-1], figures=figures)
            return AdvisorReply(text=REFUSAL)  # no tool → no figures, ever
        messages.append({"role": "assistant", "content": msg.get("content") or "", "tool_calls": tool_calls})
        for call in tool_calls:
            name = call["function"]["name"]
            args = json.loads(call["function"].get("arguments") or "{}")
            result, figs = _run_tool(name, args, tx)
            called_tools.append(name)
            figures = figs
            messages.append({"role": "tool", "tool_call_id": call["id"], "name": name,
                             "content": json.dumps(result)})
    return AdvisorReply(text=REFUSAL)
