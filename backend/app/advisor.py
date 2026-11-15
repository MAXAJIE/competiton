"""Compartment B2 — tool-calling advisor (SKILL.md §3 anti-hallucination gate).

Structural guarantee: every figure in the reply comes from a named calc-layer
function executed at answer time. If the LLM calls no tool, the reply is the
standard refusal — there is no path to figures without a tool result. Market
context is passed to the model as labeled qualitative color only and never
attached to a figure.
"""
from __future__ import annotations

import json
import re
from datetime import date

import httpx

from . import calc, config, ml
from .models import AdvisorReply, Figure, Transaction, RiskSettings

TOOL_SET = [
    {"type": "function", "function": {
        "name": "analyze_cash_flow",
        "description": "Cash balance, average monthly burn, and runway in months. Use for any cash/runway/flow/analysis question.",
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "who_owes_me",
        "description": ("Every customer who still owes money, one row per person/company: "
                        "what they owe in total, how many open invoices, how many days "
                        "overdue, and a risk rating (high/medium/low) with the reason. "
                        "Call this for ANY question that asks who — 'who owes me money', "
                        "'who should I chase', 'which customers are late', 'who is my "
                        "biggest debtor', 'list my outstanding invoices by customer'. "
                        "Never answer a who-question from ar_ap_summary: a total cannot "
                        "name anybody."),
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "who_i_owe",
        "description": ("Every supplier/bill you still have to pay, one row per party: "
                        "how much, how many days overdue or until due, and a rating. Use "
                        "for 'who do I owe', 'what bills are due', 'which suppliers are "
                        "waiting on me', 'list my payables by vendor'."),
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "ar_risk_flags",
        "description": ("Which unpaid invoices/receivables are at risk of being paid late, "
                        "with a probability and a high/medium/low severity per item from the "
                        "trained AR-risk model. Rows that are already past due come back with "
                        "already_late=true and p_late=1 (late is a fact, not a forecast). Use "
                        "for questions about late payers, bad debt, who to chase, or "
                        "collections."),
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "ar_ap_summary",
        "description": "Open receivables and payables totals, overdue AR, and aging buckets. Totals only — for named parties use who_owes_me / who_i_owe.",
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "generate_financial_statement",
        "description": "Income statement for a date range. Default: trailing 12 months if none given.",
        "parameters": {"type": "object", "properties": {"months": {"type": "integer", "description": "Length of the period in months, default 12"}}},
    }},
    {"type": "function", "function": {
        "name": "predict_next_month_revenue",
        "description": ("Projected next month's revenue from the trained regression model "
                        "(prior month + 3-month momentum + receivables state + seasonality). "
                        "Use for predict/forecast questions."),
        "parameters": {"type": "object", "properties": {}},
    }},
]

REFUSAL = ("Answer\n"
           "I don't have a tool that can answer that, so I won't guess.\n\n"
           "Next step\n"
           "Ask me about your cash flow, your receivables and payables, this year's "
           "statement, or next month's revenue projection.")

NO_DATA = ("Answer\n"
           "There are no transactions recorded yet, so there is nothing to calculate.\n\n"
           "Next step\n"
           "Add one entry (typed or scanned), then ask me again — I won't invent figures.")

OUT_OF_SCOPE = ("Answer\n"
                "That is outside what I do. I only handle your own cash flow, small-business "
                "finance and bookkeeping, tax and company-law questions as general "
                "information, and market context that affects your planning.\n\n"
                "Next step\n"
                "Ask me about cash, runway, who owes you money, your statement, or next "
                "month's projection.")

# Deliberately narrow: each entry is a whole-word topic we never answer, so an
# unrelated ask is refused for free (no model call, no web search, no cost).
OFF_TOPIC_WORDS = ("recipe", "cook", "bake", "weather", "joke", "poem", "horoscope",
                   "football", "soccer", "basketball", "celebrity", "movie", "song",
                   "lyrics", "homework", "essay", "translate", "python", "javascript",
                   "css", "html", "regex", "leetcode", "workout", "diet", "calorie",
                   "symptom", "diagnose", "medicine", "dating", "girlfriend", "boyfriend")

# Topics that need live information rather than the ledger. These switch the call
# to the ":online" model chain so the answer is grounded in a real source.
EXTERNAL_WORDS = ("rate", "rates", "fed", "fomc", "interest", "yield", "inflation",
                  "cpi", "recession", "economy", "economic", "market", "markets",
                  "stock", "shares", "index", "s&p", "nasdaq", "treasury", "bond",
                  "currency", "forex", "exchange rate", "oil", "gold", "tariff",
                  "tax", "taxes", "irs", "hmrc", "vat", "gst", "law", "legal",
                  "regulation", "compliance", "deadline", "filing", "news", "today",
                  "current", "now", "this week", "tomorrow")

# The reply shape is fixed so every answer reads the same way: what I found, the
# numbers, what to do, and the caveat. Clients render plain text, so no markdown.
REPLY_TEMPLATE = ("Answer\n"
                  "<two to four plain sentences>\n\n"
                  "Figures\n"
                  "- <label>: <value>\n\n"
                  "Next step\n"
                  "- <one concrete action>\n\n"
                  "Caveat\n"
                  "<one short line>")

SYSTEM_PROMPT = (
    "You are a private cash-flow advisor for one self-employed person or small "
    "business owner.\n\n"
    "SCOPE — answer only these: (1) this owner's own money, using the tools; "
    "(2) small-business finance and bookkeeping; (3) tax, company-law and "
    "regulatory questions as general information, never as legal or tax advice; "
    "(4) markets, interest rates and macro context that affect their planning. "
    "Anything else (recipes, coding, sport, entertainment, health, homework, small "
    "talk) is out of scope: say so in one sentence and name what you do handle.\n\n"
    "FIGURES — every number about this owner's own finances must come from a tool "
    "result in this conversation. Never compute, recall or estimate one, and never "
    "reuse a number from an earlier turn as if it were fresh. Live search results "
    "may supply external facts (a rate, a rule, a filing date): cite the source in "
    "square brackets and never present an external number as if computed from the "
    "ledger. If the search gives no number, say the number was not found rather "
    "than filling it in.\n\n"
    "FORECASTS — tomorrow's rate or price cannot be known by anyone. When asked to "
    "predict an external market move, say that plainly, give the latest recorded "
    "value with its source and date, and describe what would move it. The revenue "
    "prediction tool is different: state its method and call it a projection.\n\n"
    "LEGAL/TAX — give general information and point to a qualified professional "
    "for their specific case. Never assert that a filing is correct or compliant.\n\n"
    "NAMED QUESTIONS — when the question asks who (who owes me money, who do I owe, "
    "which customers are late, who should I chase), the answer is a list of names, "
    "not a total. Call who_owes_me (or who_i_owe) and give every party it returns its "
    "own line, most urgent first: name, amount, how late or when due, and the risk "
    "rating. Each party in the result already carries a ready-made `summary` and the "
    "result carries `figure_lines`: copy those strings after the name exactly as "
    "given, one '- <name>: <summary>' line each, then the total line. Do not "
    "reformat them, drop separators or add raw field names. "
    "If one party has several invoices, they are already summed: say so instead of "
    "listing invoices separately. Never invent a name, and never answer a who "
    "question with a sum alone. In the Answer sentences, name the two or three that "
    "matter most and why.\n\n"
    "FORMAT — plain text, exactly these four sections in this order, each label "
    "on its own line, a blank line before each label:\n"
    "Answer\n<two to four plain sentences>\n\n"
    "Figures\n- <label>: <value>  (omit this whole section if there are no numbers)\n\n"
    "Next step\n- <one concrete action>\n\n"
    "Caveat\n<one short line>\n\n"
    "Never use asterisks, hashes, underscores, backticks, pipes, tables or emoji. "
    "Use '-' for lists. Keep it short and concrete."
)


ASKS_WHO = re.compile(r"\b(who|whom|whose)\b|\bwhich (of my |of the )?"
                      r"(customers?|clients?|people|debtors?|suppliers?|vendors?)\b"
                      r"|\blist (my|the|all)\b|\bname (the|my|each)\b")
ASKS_MONEY = re.compile(r"\b(owe|owes|owed|owing|outstanding|unpaid|overdue|late|"
                        r"chase|collect|debt|receivables?|payables?|bills?|money)\b")
ASKS_PAYABLE = re.compile(r"\b(i|we) owe\b|\bdo (i|we) owe\b|\bpayables?\b|"
                          r"\bsuppliers?\b|\bvendors?\b|\bbills?\b|\bmust pay\b|"
                          r"\bto pay\b|\bpay (them|him|her|it)\b")


def party_side(question: str) -> str | None:
    """Is this a "who" question, and about which side of the ledger?

    Needed so the no-key fallback can answer "who owes me money" with names
    instead of a total, and so a who-question never drifts to the summary tool.
    """
    q = " ".join(re.findall(r"[a-z']+", question.lower()))
    if not ASKS_WHO.search(q) or not ASKS_MONEY.search(q):
        return None
    # "who do I owe" is the payable side; anything else that names a party is AR.
    return "ap" if ASKS_PAYABLE.search(q) else "ar"


def out_of_scope(question: str) -> bool:
    """Cheap deterministic guard so unrelated asks cost nothing and never reach a model."""
    q = " " + "".join(ch.lower() if ch.isalnum() else " " for ch in question) + " "
    return any(f" {w} " in q for w in OFF_TOPIC_WORDS)


def needs_web(question: str) -> bool:
    """Does this question depend on live external facts rather than the ledger?"""
    q = question.lower()
    return any(w in q for w in EXTERNAL_WORDS)


MARKDOWN_LINK = re.compile(r"\[([^\]]+)\]\((https?://[^)\s]+)\)")

# Models like typographic punctuation: non-breaking hyphens, narrow no-break
# spaces, curly quotes. They render as tofu in some clients and make text
# comparisons ("$5,000" vs "$5,000") fail, so every reply is normalised to
# ASCII. Keyed by code point so no invisible character sits in this source.
TYPOGRAPHY = {
    **{cp: "-" for cp in range(0x2010, 0x2016)}, 0x2212: "-",
    **{cp: "'" for cp in (0x2018, 0x2019, 0x201A)},
    **{cp: '"' for cp in (0x201C, 0x201D)},
    0x2026: "...",
    **{cp: " " for cp in (0x00A0, 0x2009, 0x202F, 0x205F)},
    **{cp: "" for cp in (0x200B, 0x200C, 0x200D, 0xFEFF)},
}


def tidy(text: str) -> str:
    """Strip markdown the model adds anyway, so replies read as plain text.

    Inline links become their label: the URL is already in `sources`, and a raw
    "[label](url)" in a plain-text bubble reads as noise.
    """
    out: list[str] = []
    normalised = str(text or "").translate(TYPOGRAPHY)
    for raw in normalised.splitlines():
        line = raw.rstrip()
        while line.startswith("#"):
            line = line[1:].lstrip()
        line = line.replace("**", "").replace("__", "").replace("`", "")
        line = MARKDOWN_LINK.sub(r"\1", line)
        line = line.replace("\u2022", "-").replace("\u2013", "-")
        stripped = line.lstrip()
        if stripped.startswith("* "):
            line = line[: len(line) - len(stripped)] + "- " + stripped[2:]
        out.append(line)
    cleaned = "\n".join(out)
    while "\n\n\n" in cleaned:
        cleaned = cleaned.replace("\n\n\n", "\n\n")
    return cleaned.strip()


def _party_figure(party: dict) -> Figure:
    """One party, one line: the money, how late it is, and the rating.

    Kept in the same "label: value" shape as every other figure, so a named
    answer still reads as a table instead of a paragraph.
    """
    bits = [calc.usd(party["open_amount"])]
    if party["invoice_count"] > 1:
        bits.append(f"{party['invoice_count']} invoices")
    if party["late_invoice_count"]:
        bits.append(f"{party['max_days_overdue']} days late")
    elif isinstance(party.get("days_until_due"), int):
        days = party["days_until_due"]
        bits.append("due today" if days == 0 else
                    f"due in {days} days" if days > 0 else f"{abs(days)} days late")
    elif party.get("oldest_due_date"):
        bits.append(f"due {party['oldest_due_date']}")
    p_late = party.get("p_late")
    if p_late is not None and party["risk_basis"] == "model" and not party["late_invoice_count"]:
        bits.append(f"{p_late:.0%} chance of late payment")
    bits.append(f"{party['severity']} risk")
    return Figure(label=party["party"], value=" · ".join(bits))


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
    if name in ("who_owes_me", "who_i_owe"):
        side = "ar" if name == "who_owes_me" else "ap"
        data = ml.party_balances(tx, side=side)
        figures = [_party_figure(p) for p in data["parties"][:12]]
        if data["party_count"]:
            figures.append(Figure(label="Total open", value=calc.usd(data["total_open"])))
        # Pre-formatted lines: the model copies them instead of reformatting raw
        # fields, so replies keep "$5,000" and "32 days late" instead of
        # "5000.0 severity=high p_late=1".
        for party, figure in zip(data["parties"], figures):
            party["summary"] = figure.value
        data["figure_lines"] = [f"- {f.label}: {f.value}" for f in figures]
        return (data, figures)
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
    if name == "ar_risk_flags":
        summary = ml.ar_risk_summary(tx)
        figures = [Figure(label="High risk", value=calc.usd(summary["high_risk_amount"])),
                   Figure(label="Items flagged",
                          value=f"{summary['high_risk']} of {summary['scored']}")]
        return (summary, figures)
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


def _frame(answer: str, figures: list[Figure] | None = None,
           next_step: str = "", caveat: str = "") -> str:
    """Every reply leaves here in the same four-section shape.

    A template beats "nice formatting" prompts: the shape is identical whether
    the answer came from the LLM or from the no-key fallback, the client renders
    plain text, and there are no asterisks to strip.
    """
    parts = ["Answer", answer.strip()]
    if figures:
        parts += ["", "Figures"]
        parts += [f"- {f.label}: {f.value}" for f in figures]
    if next_step:
        parts += ["", "Next step", f"- {next_step}"]
    if caveat:
        parts += ["", "Caveat", caveat]
    return "\n".join(parts)


def _party_answer(data: dict) -> AdvisorReply:
    """Names, money and risk per party — the shape both paths share."""
    ar = data["side"] == "receivable"
    parties = data["parties"]
    figures = [_party_figure(p) for p in parties[:12]]
    tool = "who_owes_me" if ar else "who_i_owe"
    if data["party_count"]:
        figures.append(Figure(label="Total open", value=calc.usd(data["total_open"])))
    if not parties:
        return AdvisorReply(tool=tool, text=_frame(
            f"Nobody {'owes you money' if ar else 'is waiting to be paid'} right now — "
            f"every {'invoice' if ar else 'bill'} in your ledger is settled.",
            next_step=(f"Record an invoice when you issue one, and I will track who owes what."
                       if ar else "Record a bill when it arrives, and I will track what is due."),
            caveat=f"Based on the {len(parties)} open rows in this ledger."))
    late = [p for p in parties if p["late_invoice_count"]]
    high = [p for p in parties if p["severity"] == "high"]
    noun = "customer" if ar else "supplier"
    noun += "" if data["party_count"] == 1 else "s"
    total = calc.usd(data["total_open"])
    if ar:
        answer = (f"{data['party_count']} {noun} {'owes' if data['party_count'] == 1 else 'owe'} "
                  f"you {total} across {sum(p['invoice_count'] for p in parties)} open "
                  f"invoice{'' if sum(p['invoice_count'] for p in parties) == 1 else 's'}.")
    else:
        answer = (f"You still owe {data['party_count']} {noun} {total} in "
                  f"{sum(p['invoice_count'] for p in parties)} open "
                  f"bill{'' if sum(p['invoice_count'] for p in parties) == 1 else 's'}.")
    if late:
        answer += (f" {len(late)} {'is' if len(late) == 1 else 'are'} already late, led by "
                   f"{late[0]['party']} ({calc.usd(late[0]['open_amount'])}, "
                   f"{late[0]['max_days_overdue']} days overdue).")
    elif high:
        answer += (f" Nothing is late yet, but {high[0]['party']} is rated high risk on "
                   f"{calc.usd(high[0]['open_amount'])}.")
    else:
        answer += " Nothing is overdue, and none of it is rated high risk."
    urgent = late[0] if late else (high[0] if high else parties[0])
    next_step = ((f"Send {urgent['party']} a short written reminder today — "
                  f"{calc.usd(urgent['open_amount'])} is the most exposed.")
                 if ar else
                 (f"Pay or renegotiate {urgent['party']} first — "
                  f"{calc.usd(urgent['open_amount'])} is the most exposed."))
    caveat = ("Late invoices are facts, the rest are the AR model's probability — "
              "a prompt to look closer, not a credit decision." if ar else
              "Payable ratings come from the due date, not from a model.")
    return AdvisorReply(tool=tool, text=_frame(answer, figures, next_step, caveat),
                        figures=figures)


SECTION_LABELS = ("Answer", "Figures", "Next step", "Caveat")


def _sections(text: str) -> dict[str, str]:
    """Split a reply into the four labelled parts, dropping anything unlabelled."""
    out: dict[str, str] = {}
    current: str | None = None
    for line in text.splitlines():
        label = line.strip().rstrip(":").strip()
        if label in SECTION_LABELS:
            current = label
            out.setdefault(current, "")
            continue
        if current:
            out[current] += line.rstrip() + "\n"
    return {k: v.strip() for k, v in out.items()}


def _with_figures(text: str, figures: list[Figure] | None) -> str:
    """The attached figures are authoritative; the text must show them.

    A model writes good sentences and copies lists badly: it drops the party
    lines, folds them into the Answer, or restyles "$5,000". So the Figures
    section is rebuilt from the tool result whenever the model's own version is
    missing a line. Same trick as `_frame` — one shape, whoever wrote it.
    """
    if not figures:
        return text
    lines = [f"- {f.label}: {f.value}" for f in figures]
    parts = _sections(text)
    original = parts.get("Answer") or text.strip()
    answer = original
    # The model sometimes copies the table into the Answer anyway, either as the
    # figure line or as "<name>" followed by its own bullet. Both are dropped, as
    # long as some prose survives.
    labels = {f.label for f in figures}
    kept: list[str] = []
    skip_bullet = False
    for line in answer.splitlines():
        text_line = line.strip()
        if text_line in labels:
            skip_bullet = True
            continue
        if skip_bullet and text_line.startswith("- "):
            skip_bullet = False
            continue
        skip_bullet = False
        if text_line in set(lines):
            continue
        kept.append(line)
    if any(ln.strip() for ln in kept):
        answer = "\n".join(kept).strip()
    while "\n\n\n" in answer:
        answer = answer.replace("\n\n\n", "\n\n")
    shown = [ln.strip() for ln in parts.get("Figures", "").splitlines() if ln.strip()]
    if answer == original and all(l in shown for l in lines) and shown and shown[-1] == lines[-1]:
        return text  # already correct, total last: do not touch what the model got right
    out = ["Answer", answer, "", "Figures", "\n".join(lines)]
    if parts.get("Next step"):
        out += ["", "Next step", parts["Next step"]]
    if parts.get("Caveat"):
        out += ["", "Caveat", parts["Caveat"]]
    return "\n".join(out)


def _deterministic_answer(q: str, tx: list[Transaction],
                          settings: RiskSettings | None = None) -> AdvisorReply:
    """Fallback when no OpenRouter key is configured (dev/demo on flaky wifi):
    same tools, same refusal rule, same reply template, no LLM involved.

    It cannot answer external questions — there is no search without a key — and
    says so instead of reciting remembered rates.
    """
    s = q.lower()
    if needs_web(q):
        return AdvisorReply(text=_frame(
            "That question depends on live outside information (a rate, a market move or "
            "a rule), and I can't look anything up without my search connection.",
            next_step="Ask me about your own numbers, or reconnect search to ask about markets.",
            caveat="I won't quote an outside figure from memory."))
    if any(k in s for k in ("predict", "forecast", "next month")):
        p = calc.predict_next_month_revenue(tx)
        figs = [Figure(label="Projected revenue", value=calc.usd(p["value"]))]
        return AdvisorReply(tool="predict_next_month_revenue",
                            text=_frame(
                                f"Next month's revenue projects to {calc.usd(p['value'])}. "
                                f"Method: {p['method']}",
                                figs,
                                next_step="Compare it with next month's committed bills before "
                                          "you commit to new spending.",
                                caveat="A projection, not a guarantee."),
                            figures=figs)
    side = party_side(q)
    if side:
        return _party_answer(ml.party_balances(tx, side=side))
    if any(k in s for k in ("at risk", "late", "chase", "collect", "bad debt")):
        summ = ml.ar_risk_summary(tx)
        top = summ["top"][0] if summ["top"] else None
        scored = summ["scored"]
        noun = "invoice" if scored == 1 else "invoices"
        if scored == 0:
            answer = "You have no open receivables to score yet."
            nxt = "Record a customer invoice when you issue one, and I can score it."
        elif summ["high_risk"] == 0:
            answer = (f"None of your {scored} open {noun} is flagged as high risk of late "
                      f"payment right now.")
            nxt = "Nothing to chase today — re-check after the next due date passes."
        else:
            answer = (f"{summ['high_risk']} of {scored} open {noun} "
                      f"{'is' if summ['high_risk'] == 1 else 'are'} high risk for late payment, "
                      f"worth {calc.usd(summ['high_risk_amount'])}.")
            overdue = summ.get("overdue_count") or 0
            if overdue:
                answer += (f" {overdue} {'is' if overdue == 1 else 'are'} already overdue "
                           f"({calc.usd(summ.get('overdue_amount') or 0)}), so those are late by "
                           f"definition rather than a forecast.")
            if top:
                if top.get("already_late"):
                    answer += (f" Most urgent: {top['vendor_or_customer']} "
                               f"({calc.usd(top['amount'])}, {top['days_overdue']} days late).")
                else:
                    answer += (f" Most urgent: {top['vendor_or_customer']} "
                               f"({calc.usd(top['amount'])}, {top['p_late']:.0%} chance of late "
                               f"payment).")
            nxt = "Send the oldest one a short written reminder today."
        figs = [Figure(label="High risk", value=calc.usd(summ["high_risk_amount"])),
                Figure(label="Items flagged", value=f"{summ['high_risk']} of {summ['scored']}")]
        return AdvisorReply(tool="ar_risk_flags",
                            text=_frame(answer, figs, nxt,
                                        "A prompt to look closer, not a credit decision."),
                            figures=figs)
    if any(k in s for k in ("ar", "ap", "receivable", "payable", "owe")):
        a = calc.get_ar_ap_summary(tx)
        figs = [Figure(label="Open AR", value=calc.usd(a["ar"])),
                Figure(label="Overdue AR", value=calc.usd(a["arOverdue"])),
                Figure(label="Open AP", value=calc.usd(a["ap"]))]
        return AdvisorReply(tool="ar_ap_summary",
                            text=_frame("Open receivables and payables come from the invoices "
                                        "and bills you have recorded.",
                                        figs,
                                        "Chase the overdue receivables first; they are already late.",
                                        "Settled invoices drop out of these totals."),
                            figures=figs)
    if any(k in s for k in ("cash", "runway", "flow", "analy")):
        runway = calc.get_runway_months(tx)
        figs = [Figure(label="Cash balance", value=calc.usd(calc.get_cash_balance(tx)))]
        if runway is not None:
            figs.append(Figure(label="Runway", value=f"{runway:.1f} months"))
        if runway is not None and settings and settings.enabled and runway < settings.low_cash_threshold_months:
            answer = (f"Your runway is below your own warning threshold of "
                      f"{settings.low_cash_threshold_months:g} months.")
        else:
            answer = "Your cash balance and runway are below."
        return AdvisorReply(tool="analyze_cash_flow",
                            text=_frame(answer, figs,
                                        "Collecting overdue receivables is the fastest lever.",
                                        "Runway assumes recent spending continues."),
                            figures=figs)
    if any(k in s for k in ("statement", "p&l", "profit")):
        st = calc.generate_financial_statement(tx)
        figs = [Figure(label="Total income", value=calc.usd(st["total_income"])),
                Figure(label="Total expenses", value=calc.usd(st["total_expense"])),
                Figure(label="Net profit", value=calc.usd(st["net"]))]
        return AdvisorReply(tool="generate_financial_statement",
                            text=_frame(f"Income statement for {st['period_start']} to "
                                        f"{st['period_end']}.",
                                        figs,
                                        "Use the expense lines to spot what grew fastest.",
                                        "Accrual view: it includes pending income."),
                            figures=figs)
    return AdvisorReply(text=REFUSAL)


def _complete(messages: list[dict], models: list[str],
              api_key: str | None = None) -> dict | None:
    """One chat completion, walking the given model chain on provider errors.

    `models` is either the plain chain or the ":online" chain, which makes
    OpenRouter run a web search and attach url citations to the reply.
    """
    last_error = ""
    for model in models:
        try:
            r = httpx.post(
                f"{config.OPENROUTER_BASE}/chat/completions",
                headers={"Authorization": f"Bearer {config.request_key(api_key)}",
                         "HTTP-Referer": "https://cashmonitoring.app",
                         "X-Title": "CashMonitoring Advisor"},
                # Reasoning models spend this budget on hidden reasoning first, so
                # keep it generous or the tool call never materialises.
                json={"model": model, "messages": messages, "tools": TOOL_SET,
                      "tool_choice": "auto", "max_tokens": config.ADVISOR_MAX_TOKENS,
                      "temperature": 0.2,
                      **({"reasoning": config.ADVISOR_REASONING_PARAM}
                         if config.ADVISOR_REASONING_PARAM else {})},
                timeout=120,
            )
            if r.status_code != 200:
                last_error = f"{model} -> HTTP {r.status_code}"
                continue
            return r.json()["choices"][0]["message"]
        except Exception as e:
            last_error = f"{model} -> {e}"
    print(f"advisor: no model reachable ({last_error})")
    return None


def _sources(msg: dict) -> list[dict]:
    """Citations the web plugin attached, deduped, newest call only."""
    out: list[dict] = []
    for a in msg.get("annotations") or []:
        if not isinstance(a, dict):
            continue
        cite = a.get("url_citation") or {}
        url = cite.get("url")
        if not url or any(s["url"] == url for s in out):
            continue
        out.append({"title": (cite.get("title") or url)[:160], "url": url})
    return out[:4]


def _fallback(question: str, tx: list[Transaction],
              settings: RiskSettings | None = None) -> AdvisorReply:
    """The rules answer, or the standard refusal if the rules cannot help.

    Used whenever the model produces nothing usable (unreachable, empty message,
    no tool call). It keeps the "no figure without a tool" guarantee — the rules
    call the same calc/model functions — and turns a dead end into an answer.
    """
    rule = _deterministic_answer(question, tx, settings)
    return rule if rule.text != REFUSAL else AdvisorReply(text=REFUSAL)


def ask(question: str, tx: list[Transaction], settings: RiskSettings | None = None,
        api_key: str | None = None) -> AdvisorReply:
    # Out-of-scope asks are refused deterministically: no model call, no search,
    # no cost, and no chance of the advisor drifting into general chit-chat.
    if out_of_scope(question):
        return AdvisorReply(text=OUT_OF_SCOPE)

    web = needs_web(question)
    if not tx and not web:
        # Nothing recorded yet and nothing external to look up: say so rather
        # than computing over an empty set.
        return AdvisorReply(text=NO_DATA)
    if not config.request_key(api_key):
        return _deterministic_answer(question, tx, settings)

    def to_llm(t: Transaction) -> dict:
        return t.model_dump(exclude_none=True)

    system = SYSTEM_PROMPT + _market_context()
    if web:
        system += ("\n\nLive web search is enabled for this question. Use it for any "
                   "external fact (a rate, a rule, a filing date, a news event), give the "
                   "value with its date, and cite the source URL in square brackets. If "
                   "the search returns nothing usable, say the figure was not found.")
    messages: list[dict] = [
        {"role": "system", "content": system},
        {"role": "user", "content": question + "\n\nYour only source for the owner's "
             f"own figures is the ledger passed to the tools ({len(tx)} rows): " +
             json.dumps([to_llm(t) for t in tx])},
    ]

    models = config.ADVISOR_WEB_MODELS if web else config.ADVISOR_MODELS
    called_tools: list[str] = []
    figures: list[Figure] = []
    for _ in range(3):
        msg = _complete(messages, models, api_key)
        if msg is None:
            if not web:
                # No model, but the rules still answer from the ledger with real
                # figures. A plainer answer beats a dead end.
                return _fallback(question, tx, settings)
            return AdvisorReply(text=tidy(
                "Answer\nThe advisor is unavailable right now (no model reachable). "
                "Nothing was guessed.\n\nNext step\nTry again in a moment, or read the "
                "figures straight off the dashboard."))
        sources = _sources(msg)
        tool_calls = msg.get("tool_calls") or []
        if not tool_calls:
            content = (msg.get("content") or "").strip()
            # A reasoning model occasionally emits tool calls and then an empty
            # final message. An empty bubble is not an answer, so fall through to
            # the rules rather than shipping "".
            if called_tools and content:
                return AdvisorReply(text=_with_figures(tidy(content), figures),
                                    tool=called_tools[-1],
                                    figures=figures, sources=sources or None)
            # No tool and no ledger claim: acceptable only when the question was
            # about external facts, where the answer rests on search citations
            # rather than on the owner's data. Ledger questions still refuse —
            # but the rules can usually answer them with real figures, which is
            # better than a dead end.
            if web and content:
                return AdvisorReply(text=tidy(content), tool="web_search",
                                    sources=sources or None)
            return _fallback(question, tx, settings)
        messages.append({"role": "assistant", "content": msg.get("content") or "", "tool_calls": tool_calls})
        for call in tool_calls:
            name = call["function"]["name"]
            args = json.loads(call["function"].get("arguments") or "{}")
            result, figs = _run_tool(name, args, tx)
            called_tools.append(name)
            figures = figs
            messages.append({"role": "tool", "tool_call_id": call["id"], "name": name,
                             "content": json.dumps(result)})
    return _fallback(question, tx, settings)
