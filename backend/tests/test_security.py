"""Security primitives: redaction, input cleaning, rate limits, cache headers."""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from app import cache, security
from app.models import (
    AdvisorQuestion, LoginBody, RiskSettings, SignupBody, Transaction,
    transaction_from_row,
)


# --- redaction ---------------------------------------------------------------

def test_an_openrouter_key_never_survives_redaction():
    text = "401 from provider with key sk-or-v1-abcdef0123456789abcdef0123456789"
    out = security.redact(text)
    assert "abcdef0123456789" not in out
    assert security.REDACTED in out


def test_a_bearer_header_is_redacted_with_its_token():
    out = security.redact("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def")
    assert "eyJhbGciOiJIUzI1NiJ9" not in out


def test_redaction_caps_the_length():
    assert len(security.redact("x" * 5000)) == 400


def test_ordinary_error_text_is_left_alone():
    out = security.redact("model -> HTTP 429: rate limited")
    assert out == "model -> HTTP 429: rate limited"


# --- input cleaning ----------------------------------------------------------

def test_control_characters_and_markup_are_removed():
    cleaned = security.clean_text("  Acme\x00 Ltd\x1b <script>alert(1)</script>  ", max_len=200)
    assert cleaned == "Acme Ltd scriptalert(1)/script"


def test_newlines_collapse_when_not_allowed():
    assert security.clean_text("a\n\nb\t c", max_len=50) == "a b c"


def test_long_text_is_refused_not_silently_truncated():
    with pytest.raises(ValueError):
        security.clean_text("x" * 201, max_len=200)


# --- rate limiter ------------------------------------------------------------

def test_the_budget_is_spent_then_refused():
    limiter = security.RateLimiter()
    assert limiter.allow("k", 2, 60)[0] is True
    assert limiter.allow("k", 2, 60)[0] is True
    allowed, retry = limiter.allow("k", 2, 60)
    assert allowed is False
    assert retry > 0


def test_buckets_are_independent_and_resettable():
    limiter = security.RateLimiter()
    limiter.allow("a", 1, 60)
    assert limiter.allow("b", 1, 60)[0] is True
    assert limiter.allow("a", 1, 60)[0] is False
    limiter.reset()
    assert limiter.allow("a", 1, 60)[0] is True


def test_signup_is_throttled_on_the_route_that_actually_exists():
    # A rule for a path that is not routed is a limit nobody is under: this
    # asserted "/api/account/signup" once, while the endpoint is /api/auth/signup.
    limit, window = security.budget_for("/api/auth/signup", "POST")
    assert limit <= 10
    assert window >= 300


def test_the_expensive_routes_get_the_tighter_budget():
    ocr_budget = security.budget_for("/api/documents/ocr", "POST")
    read_budget = security.budget_for("/api/transactions", "GET")
    assert ocr_budget[0] < read_budget[0]
    # A path that merely starts with a limited prefix keeps the tighter budget.
    assert security.budget_for("/api/ai/key/test", "POST")[0] == 10


def test_a_variable_path_does_not_get_a_fresh_bucket():
    # /api/documents/<id>/confirm must not reset its budget per id.
    assert security.rule_scope("/api/documents/abc/confirm", "POST") ==         security.rule_scope("/api/documents/xyz/confirm", "POST")
    assert security.rule_scope("/api/documents/ocr", "POST") == "/api/documents/ocr"
    assert security.rule_scope("/api/transactions", "GET") == security.rule_scope("/api/whatever", "GET")


def test_a_token_and_an_ip_make_different_buckets():
    assert security.client_key("1.2.3.4", "Bearer abc") != security.client_key("1.2.3.4", "Bearer xyz")
    assert security.client_key("1.2.3.4", None) != security.client_key("5.6.7.8", None)


# --- headers -----------------------------------------------------------------

def test_shared_gets_are_cacheable_and_user_data_is_not():
    assert "public" in security.cache_control_for("/api/categories", "GET")
    assert "max-age=300" in security.cache_control_for("/api/ai/config", "GET")
    assert "public" in security.cache_control_for("/api/legal", "GET")
    assert security.cache_control_for("/api/transactions", "GET") == "no-store"
    assert security.cache_control_for("/api/settings", "GET") == "no-store"
    # A write is never cacheable, whatever the path.
    assert security.cache_control_for("/api/categories", "POST") == "no-store"


# --- cache -------------------------------------------------------------------

def test_the_cache_returns_a_value_until_it_expires():
    cache.clear()
    calls = {"n": 0}

    def produce() -> dict:
        calls["n"] += 1
        return {"v": calls["n"]}

    assert cache.cached("k", 60, produce) == {"v": 1}
    assert cache.cached("k", 60, produce) == {"v": 1}
    assert calls["n"] == 1
    cache.invalidate("k")
    assert cache.cached("k", 60, produce) == {"v": 2}


def test_an_expired_entry_is_recomputed():
    cache.clear()
    assert cache.cached("short", 0, lambda: "first") == "first"
    assert cache.cached("short", 0, lambda: "second") == "second"


# --- strict models -----------------------------------------------------------

def _tx(**over) -> dict:
    base = {"type": "expense", "amount": 10, "transaction_date": "2024-05-01"}
    return {**base, **over}


def test_an_unknown_field_is_rejected_so_ownership_cannot_be_injected():
    with pytest.raises(ValidationError):
        Transaction(**_tx(user_id="someone-else"))


def test_a_non_positive_or_absurd_amount_is_rejected():
    with pytest.raises(ValidationError):
        Transaction(**_tx(amount=0))
    with pytest.raises(ValidationError):
        Transaction(**_tx(amount=-5))
    with pytest.raises(ValidationError):
        Transaction(**_tx(amount=1e15))
    with pytest.raises(ValidationError):
        Transaction(**_tx(amount=float("nan")))


def test_dates_must_be_real_calendar_dates():
    with pytest.raises(ValidationError):
        Transaction(**_tx(transaction_date="2024-02-31"))
    with pytest.raises(ValidationError):
        Transaction(**_tx(transaction_date="01/05/2024"))
    with pytest.raises(ValidationError):
        Transaction(**_tx(transaction_date="2024-05-01", due_date="9999-01-01"))


def test_a_vendor_name_is_cleaned_and_capped():
    row = Transaction(**_tx(vendor_or_customer="  A\x00cme <b>Ltd</b>  "))
    assert row.vendor_or_customer == "Acme bLtd/b"
    with pytest.raises(ValidationError):
        Transaction(**_tx(vendor_or_customer="x" * 201))


def test_a_row_from_the_database_does_not_leak_its_owner():
    row = {"id": "abc", "user_id": "secret-owner", "type": "income", "amount": 5,
           "transaction_date": "2024-05-01", "vendor_or_customer": "Acme",
           "category": "Sales", "status": "paid", "source": "manual"}
    model = transaction_from_row(row)
    dumped = model.model_dump()
    assert "user_id" not in dumped
    assert dumped["id"] == "abc"


def test_the_risk_vault_is_bounded():
    assert RiskSettings(low_cash_threshold_months=12).low_cash_threshold_months == 12
    with pytest.raises(ValidationError):
        RiskSettings(low_cash_threshold_months=99)
    with pytest.raises(ValidationError):
        RiskSettings(ar_overdue_spike_pct=101)
    with pytest.raises(ValidationError):
        RiskSettings(warning_email="not-an-email")
    # Empty stays allowed: an account may simply not want the report.
    assert RiskSettings(warning_email="").warning_email == ""


def test_an_advisor_question_is_length_limited():
    with pytest.raises(ValidationError):
        AdvisorQuestion(question="")
    with pytest.raises(ValidationError):
        AdvisorQuestion(question="q" * 2001)
    assert AdvisorQuestion(question="  how is\n\nmy runway?  ").question == "how is\nmy runway?"


def test_registration_requires_a_real_email_and_password():
    with pytest.raises(ValidationError):
        LoginBody(email="not-an-email", password="x")
    with pytest.raises(ValidationError):
        SignupBody(email="a@b.co", password="short1", age_confirmed=True,
                   terms_accepted=True, terms_version="1.0", privacy_version="1.0")
    with pytest.raises(ValidationError):
        SignupBody(email="a@b.co", password="onlyletters", age_confirmed=True,
                   terms_accepted=True, terms_version="1.0", privacy_version="1.0")
    ok = SignupBody(email=" A@B.co ", password="longenough1", age_confirmed=True,
                    terms_accepted=True, terms_version="1.0", privacy_version="1.0")
    assert ok.email == "a@b.co"
