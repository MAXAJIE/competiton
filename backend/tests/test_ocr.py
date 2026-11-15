"""OCR: one image = one independent entry, and unreadable images are reported."""
from app.ocr import _unreadable, normalize_fields


def entry_fields(amount=10.0, vendor="Mesa Retail"):
    return normalize_fields({"transaction_date": "2025-07-30", "vendor_or_customer": vendor,
                             "amount": amount, "type": "expense", "status": "paid"},
                            "receipt")[0]


def test_a_normal_document_is_not_flagged_unreadable():
    assert _unreadable({"is_document": True}, entry_fields()) is None
    assert _unreadable({}, entry_fields()) is None  # models that omit the key


def test_a_logo_or_photo_is_reported_with_the_models_word_for_it():
    reason = _unreadable({"is_document": False, "reason": "a bubble-tea app icon"},
                         entry_fields())
    assert reason is not None
    assert "not a document" in reason and "bubble-tea" in reason


def test_a_document_with_nothing_readable_is_unreadable():
    blank = normalize_fields({}, "receipt")[0]  # no amount, no vendor
    reason = _unreadable({"is_document": True}, blank)
    assert reason == "no amount or vendor could be read from this image"


def test_a_document_with_only_an_amount_still_gets_an_entry():
    # the reviewer can type the vendor; the amount is the hard part
    fields = normalize_fields({"amount": 42.5, "type": "expense"}, "receipt")[0]
    assert _unreadable({}, fields) is None


# --- reasoning budget --------------------------------------------------------

def test_ocr_request_turns_hidden_reasoning_off():
    """A receipt is a form, not a puzzle: reasoning tokens were eating the budget."""
    from app import config
    from app.ocr import build_payload
    payload = build_payload("some/model", "receipt", [("a.png", "image/png", b"x")], 800)
    assert payload["reasoning"] == config.OCR_REASONING_PARAM
    assert payload["max_tokens"] == 800
    assert payload["temperature"] == 0


def test_reasoning_mode_mapping():
    from app.config import _reasoning_param
    assert _reasoning_param("off") == {"enabled": False}
    assert _reasoning_param("OFF") == {"enabled": False}
    assert _reasoning_param("low") == {"effort": "low"}
    assert _reasoning_param("high") == {"effort": "high"}
    assert _reasoning_param("") is None
    assert _reasoning_param("nonsense") is None


def test_default_ocr_budget_is_small_because_reasoning_is_off():
    from app import config
    assert config.OCR_MAX_TOKENS <= 1200, "a big budget hides reasoning burn instead of fixing it"
    assert config.OCR_REASONING_PARAM == {"enabled": False}


# --- document type detection -------------------------------------------------

def test_a_photo_name_does_not_decide_the_document_type():
    """The reported bug: an invoice headed "Invoice" was read as a receipt."""
    from app.ocr import resolve_doc_type
    assert resolve_doc_type("", "image.png", "invoice") == "invoice"
    assert resolve_doc_type("", "IMG_4821.jpg", "invoice") == "invoice"
    assert resolve_doc_type("", "image.png", "bank_statement") == "bank_statement"


def test_a_deliberate_choice_beats_the_page_reading():
    from app.ocr import resolve_doc_type
    assert resolve_doc_type("receipt", "March-invoice.pdf", "invoice") == "receipt"


def test_the_filename_is_a_fallback_after_the_page():
    from app.ocr import resolve_doc_type, filename_guess
    assert resolve_doc_type("", "March-invoice.pdf", None) == "invoice"
    assert resolve_doc_type("", "bank_statement_oct.pdf", None) == "bank_statement"
    assert filename_guess("image.png") is None
    assert filename_guess("photo-1234.jpg") is None
    # and only then does it fall back to receipt
    assert resolve_doc_type("", "image.png", None) == "receipt"


def test_unknown_model_types_are_ignored_not_stored():
    from app.ocr import resolve_doc_type, valid_doc_type
    assert valid_doc_type("Invoice") == "invoice"
    assert valid_doc_type("bank statement") == "bank_statement"
    assert valid_doc_type("sales order") is None
    assert resolve_doc_type("", "image.png", "sales order") == "receipt"


def test_auto_prompt_asks_the_model_to_classify_and_lists_every_taxonomy():
    from app.ocr import _prompt
    text = _prompt("")  # no hint -> auto
    assert "doc_type" in text
    assert "invoice" in text and "receipt" in text and "bank_statement" in text
    # categories from all four types are offered, since the type is not known yet
    assert "Housing" in text and "Salary" in text and "Customer Invoice" in text


def test_invoice_review_notes_which_side_the_money_is_on():
    from app.ocr import normalize_fields
    fields, notes = normalize_fields(
        {"transaction_date": "2025-07-30", "vendor_or_customer": "Estelle Darcy",
         "amount": 957, "type": "ap", "status": "pending"}, "invoice")
    assert fields["type"] == "ap"
    assert any("bill you owe (AP)" in n for n in notes)


def test_an_invoice_gets_an_invoice_category_not_a_catch_all():
    from app.ocr import normalize_fields
    for model_type, expected in (("ap", "Supplier Bill"), ("ar", "Customer Invoice")):
        fields, notes = normalize_fields(
            {"transaction_date": "2025-07-30", "vendor_or_customer": "Estelle Darcy",
             "amount": 957, "type": model_type, "category": "Shopping"}, "invoice")
        assert fields["category"] == expected, model_type
        assert any("it is an invoice" in n for n in notes)
