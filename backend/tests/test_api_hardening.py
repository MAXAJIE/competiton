"""Route-level guarantees: the legal gate, rate limits, headers, deletion, uploads.

These use FastAPI's TestClient, which runs the real middleware stack — that is
the point: the rules being tested (a budget, a header, a 400 before Supabase is
touched) only exist if a request actually passes through them.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import config, db, security
from app.main import app, current_user_id

UID = "00000000-0000-0000-0000-000000000123"


@pytest.fixture(autouse=True)
def quiet_limiter(monkeypatch):
    """Most tests care about something other than budgets."""
    monkeypatch.setattr(config, "RATE_LIMIT_ENABLED", False)
    security.limiter.reset()
    yield
    security.limiter.reset()


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def as_user() -> None:
    app.dependency_overrides[current_user_id] = lambda: UID


@pytest.fixture(autouse=True)
def clear_overrides():
    yield
    app.dependency_overrides.clear()


# --- legal gate --------------------------------------------------------------

def _signup_body(**over):
    body = {
        "email": "new@example.com",
        "password": "longenough1",
        "age_confirmed": True,
        "terms_accepted": True,
        "terms_version": config.TERMS_VERSION,
        "privacy_version": config.PRIVACY_VERSION,
    }
    body.update(over)
    return body


def test_signup_without_accepting_the_terms_is_refused(client):
    r = client.post("/api/auth/signup", json=_signup_body(terms_accepted=False))
    assert r.status_code == 400
    assert "Terms" in r.json()["detail"]


def test_signup_without_the_age_affirmation_is_refused(client):
    r = client.post("/api/auth/signup", json=_signup_body(age_confirmed=False))
    assert r.status_code == 400
    assert str(config.MIN_AGE) in r.json()["detail"]


def test_signup_against_an_old_terms_version_is_refused(client):
    r = client.post("/api/auth/signup", json=_signup_body(terms_version="0.9"))
    assert r.status_code == 409
    assert "reload" in r.json()["detail"].lower()


def test_signup_rejects_an_extra_field(client):
    r = client.post("/api/auth/signup", json=_signup_body(admin=True))
    assert r.status_code == 422


def test_consent_cannot_be_recorded_without_the_boxes(client):
    as_user()
    r = client.post("/api/account/consent", json={
        "age_confirmed": True, "terms_accepted": False,
        "terms_version": config.TERMS_VERSION,
        "privacy_version": config.PRIVACY_VERSION,
    })
    assert r.status_code == 400


def test_consent_requires_a_signed_in_user(client):
    r = client.get("/api/account/consent")
    assert r.status_code == 401


def test_the_consent_record_is_returned_for_the_settings_screen(client, monkeypatch):
    as_user()
    monkeypatch.setattr(db, "get_consent", lambda uid: {
        "terms_version": config.TERMS_VERSION,
        "privacy_version": config.PRIVACY_VERSION,
        "age_confirmed": True,
        "accepted_at": "2026-01-01T00:00:00+00:00",
    })
    body = client.get("/api/account/consent").json()
    assert body["consent"]["terms_version"] == config.TERMS_VERSION
    assert body["min_age"] == config.MIN_AGE


# --- deletion ----------------------------------------------------------------

def test_deleting_data_requires_a_user(client):
    assert client.delete("/api/account/data").status_code == 401
    assert client.delete("/api/account").status_code == 401


def test_deleting_data_reports_what_went(client, monkeypatch):
    as_user()
    monkeypatch.setattr(db, "purge_user_content", lambda uid: {
        "transactions": 7, "documents": 2, "risk_settings": 1, "uploads": 2})
    body = client.delete("/api/account/data").json()
    assert body["ok"] is True
    assert body["deleted"]["transactions"] == 7


def test_deleting_the_account_erases_the_user(client, monkeypatch):
    as_user()
    calls = {}

    def fake_delete(uid):
        calls["uid"] = uid
        return {"transactions": 1, "documents": 0, "risk_settings": 1,
                "uploads": 0, "account": "deleted"}

    monkeypatch.setattr(db, "delete_account", fake_delete)
    body = client.delete("/api/account").json()
    assert body["deleted"]["account"] == "deleted"
    assert calls["uid"] == UID


def test_retention_can_be_applied_on_demand(client, monkeypatch):
    as_user()
    monkeypatch.setattr(db, "enforce_retention", lambda uid: {"transactions": 3, "documents": 0})
    body = client.post("/api/account/retention").json()
    assert body["removed"]["transactions"] == 3
    assert body["max_transactions"] == config.RETENTION_MAX_TRANSACTIONS


# --- legal constants ---------------------------------------------------------

def test_the_legal_endpoint_publishes_versions_and_retention(client):
    body = client.get("/api/legal").json()
    assert body["terms_version"] == config.TERMS_VERSION
    assert body["min_age"] >= 18
    assert body["retention"]["documents_days"] == config.RETENTION_DAYS_DOCUMENTS
    assert body["purpose"] == "research_and_education_only"


# --- headers, caching and rate limits ---------------------------------------

def test_every_response_carries_the_security_headers(client):
    r = client.get("/api/health")
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert r.headers["X-Frame-Options"] == "DENY"
    assert r.headers["Referrer-Policy"] == "no-referrer"


def test_shared_get_is_cacheable_and_an_error_is_not(client):
    assert "public" in client.get("/api/categories").headers["Cache-Control"]
    unauth = client.get("/api/transactions")
    assert unauth.status_code == 401
    assert unauth.headers["Cache-Control"] == "no-store"


def test_a_budget_runs_out_with_a_retry_after(client, monkeypatch):
    monkeypatch.setattr(config, "RATE_LIMIT_ENABLED", True)
    monkeypatch.setattr(security, "RULES", (("/api/categories", ("GET",), 2, 60),))
    assert client.get("/api/categories").status_code == 200
    assert client.get("/api/categories").status_code == 200
    third = client.get("/api/categories")
    assert third.status_code == 429
    assert int(third.headers["Retry-After"]) >= 1
    assert "Too many requests" in third.json()["detail"]


def test_writes_are_not_limited_by_the_read_budget(client, monkeypatch):
    monkeypatch.setattr(config, "RATE_LIMIT_ENABLED", True)
    monkeypatch.setattr(security, "RULES", (("/api/categories", ("GET",), 1, 60),))
    assert client.get("/api/categories").status_code == 200
    assert client.get("/api/categories").status_code == 429
    # A different method has its own bucket (and here, the default budget).
    assert client.post("/api/categories/classify", json={"vendor": "AWS"}).status_code == 200


# --- uploads -----------------------------------------------------------------

def test_uploads_are_checked_by_signature_not_by_name(client):
    from app.main import _validate_upload

    name, kind = _validate_upload("receipt.png", "image/png", b"\x89PNG\r\n\x1a\nrest")
    assert name == "receipt.png" and kind == "image/png"

    with pytest.raises(ValueError, match="does not match"):
        _validate_upload("receipt.png", "image/png", b"%PDF-1.7 something")

    with pytest.raises(ValueError, match="not a readable image"):
        _validate_upload("receipt.png", "image/png", b"MZ\x90\x00windows-executable")


def test_an_oversized_or_empty_upload_is_refused_before_the_model():
    from app.main import _validate_upload

    with pytest.raises(ValueError, match="empty"):
        _validate_upload("a.png", "image/png", b"")
    with pytest.raises(ValueError, match="larger than"):
        _validate_upload("a.png", "image/png", b"\x89PNG\r\n\x1a\n" + b"x" * (config.MAX_UPLOAD_BYTES + 1))


def test_a_disallowed_content_type_is_refused():
    from app.main import _validate_upload

    with pytest.raises(ValueError, match="not an accepted file type"):
        _validate_upload("a.svg", "image/svg+xml", b"\x89PNG\r\n\x1a\n")


def test_ocr_requires_auth_and_a_file(client):
    assert client.post("/api/documents/ocr").status_code == 401


# --- transactions ------------------------------------------------------------

def test_a_transaction_with_injected_fields_is_refused(client):
    as_user()
    r = client.post("/api/transactions", json={
        "type": "income", "amount": 10, "transaction_date": "2024-05-01",
        "user_id": "someone-else",
    })
    assert r.status_code == 422


def test_a_transaction_with_a_bad_date_is_refused_before_the_database(client):
    as_user()
    r = client.post("/api/transactions", json={
        "type": "income", "amount": 10, "transaction_date": "yesterday",
    })
    assert r.status_code == 422


def test_a_guests_ledger_is_not_readable(client):
    assert client.get("/api/transactions").status_code == 401


# --- OCR confirm -------------------------------------------------------------

def test_confirming_a_scan_with_a_non_uuid_id_is_refused(client):
    from app import ocr

    as_user()
    r = client.post("/api/documents/not-a-uuid/confirm", json={"amount": 10})
    assert r.status_code == 400
    assert "Unknown document" in r.json()["detail"]


def test_confirming_a_scan_ignores_extra_draft_fields(client, monkeypatch):
    from app import ocr

    as_user()
    seen: dict = {}

    def fake_confirm(uid, document_id, fields):
        seen["fields"] = fields
        return {"id": "11111111-1111-1111-1111-111111111111", "type": "expense",
                "amount": 12.5, "transaction_date": "2024-05-01", "category": "Software",
                "vendor_or_customer": "AWS", "status": "paid", "source": "ocr"}

    monkeypatch.setattr(ocr, "confirm_and_save", fake_confirm)
    r = client.post("/api/documents/11111111-1111-1111-1111-111111111111/confirm",
                    json={"amount": 12.5, "vendor_or_customer": " AWS ",
                          "notes": ["read from the top right"], "model": "vision-model"})
    assert r.status_code == 200
    assert seen["fields"] == {"amount": 12.5, "vendor_or_customer": "AWS"}


def test_confirming_a_scan_with_a_bad_date_or_amount_is_refused(client):
    as_user()
    r = client.post("/api/documents/11111111-1111-1111-1111-111111111111/confirm",
                    json={"amount": 10, "transaction_date": "01/05/2024"})
    assert r.status_code == 422
    r = client.post("/api/documents/11111111-1111-1111-1111-111111111111/confirm",
                    json={"amount": -3})
    assert r.status_code == 422
