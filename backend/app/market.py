"""Compartment B3 — market snapshot job (SKILL.md §6).

A scheduled or on-demand job writing into market_snapshot — never fetched
per-request. Fixed yfinance indicator set (numbers, not interpretation) + a
handful of cached headlines from a fixed RSS set. The advisor may use this
only as labeled qualitative commentary, never as a quantitative input.
"""
from __future__ import annotations

import xml.etree.ElementTree as ET
from datetime import datetime, timezone

import httpx
import yfinance as yf

from . import config, db

INDICATORS: list[tuple[str, str]] = [
    ("US 10Y", "^TNX"),
    ("VIX", "^VIX"),
    ("DXY", "DX-Y.NYB"),
    ("WTI", "CL=F"),
]


def _fetch_indicators() -> list[dict]:
    out = []
    for label, symbol in INDICATORS:
        try:
            hist = yf.Ticker(symbol).history(period="5d")
            closes = hist["Close"].dropna()
            if len(closes) < 2:
                continue
            last, prev = float(closes.iloc[-1]), float(closes.iloc[-2])
            delta = last - prev
            unit = "%" if label in ("US 10Y", "VIX") else ""
            d = f"{delta:+.2f}{unit}" if unit else f"{delta:+.2f}"
            out.append({"k": label, "v": f"{last:.2f}{unit}", "d": d})
        except Exception:
            continue  # never let one bad ticker break the snapshot job
    return out


def _fetch_headlines(limit: int = 4) -> list[str]:
    heads: list[str] = []
    for url in config.NEWS_FEEDS:
        try:
            r = httpx.get(url, timeout=15, headers={"User-Agent": "cashmonitoring/0.1"})
            r.raise_for_status()
            root = ET.fromstring(r.content)
            for item in root.iter("item"):
                title = item.findtext("title")
                if title:
                    heads.append(title.strip())
                if len(heads) >= limit:
                    return heads
        except Exception:
            continue
    return heads


def refresh() -> dict:
    """Pull indicators + headlines and write one cached market_snapshot row."""
    indicators = _fetch_indicators()
    headlines = _fetch_headlines()
    row = db.save_market_snapshot(indicators, headlines)
    row["indicators_json"], row["headlines_json"] = indicators, headlines
    return row


def latest() -> dict | None:
    snap = db.latest_market_snapshot()
    if snap:
        snap.setdefault("fetched_at", datetime.now(timezone.utc).isoformat())
    return snap
