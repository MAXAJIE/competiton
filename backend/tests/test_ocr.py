"""Per-page OCR merging: the multi-page review steps through these pages."""
from app.ocr import _merge_pages


def page(index, **fields):
    return {"index": index, "fields": fields, "notes": [], "model": "test"}


def test_first_page_wins_for_fields_it_can_read():
    merged, notes = _merge_pages([
        page(1, vendor_or_customer="Northgate Supplies", amount=410.5),
        page(2, vendor_or_customer="", amount=410.5, transaction_date="2026-11-12"),
    ])
    assert merged["vendor_or_customer"] == "Northgate Supplies"
    assert merged["transaction_date"] == "2026-11-12"  # page 1 had none
    assert any("2 pages" in n for n in notes)


def test_empty_values_on_an_earlier_page_do_not_block_a_later_one():
    merged, _ = _merge_pages([
        page(1, amount=None, vendor_or_customer=""),
        page(2, amount=99.0, vendor_or_customer="Mesa Retail"),
    ])
    assert merged["amount"] == 99.0
    assert merged["vendor_or_customer"] == "Mesa Retail"


def test_pages_that_disagree_on_the_amount_raise_a_review_note():
    merged, notes = _merge_pages([page(1, amount=100.0), page(2, amount=145.0)])
    assert merged["amount"] == 100.0
    assert any("disagree on the amount" in n for n in notes)


def test_page_level_notes_are_attributed_to_their_page():
    first = page(1, amount=10.0)
    first["notes"] = ["date not readable"]
    merged, notes = _merge_pages([first, page(2, amount=10.0)])
    assert "Page 1: date not readable" in notes
    assert merged["amount"] == 10.0


def test_single_page_produces_no_merge_noise():
    merged, notes = _merge_pages([page(1, amount=5.0)])
    assert merged == {"amount": 5.0}
    assert notes == []
