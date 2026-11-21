"""Settlement rules: a recorded payment closes the invoice it pays."""
from app.models import Transaction
from app import settlement


def ar(vendor, amount, due, status="overdue", date="2026-09-01", category="Customer Invoice"):
    return Transaction(type="ar", category=category, vendor_or_customer=vendor, amount=amount,
                       transaction_date=date, due_date=due, status=status)


def income(vendor, amount, status="paid", date="2026-11-14"):
    return Transaction(type="income", vendor_or_customer=vendor, amount=amount,
                       transaction_date=date, status=status)


def bill(vendor, amount, due, status="overdue", date="2026-09-01"):
    return Transaction(type="ap", category="Supplier Bill", vendor_or_customer=vendor,
                       amount=amount, transaction_date=date, due_date=due, status=status)


def spend(vendor, amount, status="paid", date="2026-11-14"):
    return Transaction(type="expense", category="Work & Business", vendor_or_customer=vendor,
                       amount=amount, transaction_date=date, status=status)


OPEN = [
    ar("Mesa Retail", 6400, "2026-09-15"),
    ar("Linden Studio", 3200, "2026-10-01"),
    ar("Oak & Pine Co.", 5200, "2026-11-28", "pending"),
]


def test_exact_payment_closes_the_matching_invoice():
    closed = settlement.settleable(OPEN, income("Mesa Retail", 6400))
    assert [r.vendor_or_customer for r in closed] == ["Mesa Retail"]


def test_company_suffixes_and_case_do_not_block_a_match():
    assert settlement.same_party("Oak & Pine", "Oak & Pine Co.")
    assert settlement.same_party("mesa retail", "Mesa Retail Ltd")
    assert settlement.normalise_party("Oak & Pine Co.") == "oak pine"


def test_different_customers_never_settle():
    assert settlement.settleable(OPEN, income("Mesa Retail", 6400)) != []
    assert settlement.settleable(OPEN, income("Harbor Cafe", 2100)) == []
    # A short name must not match as a loose prefix.
    assert not settlement.same_party("Oak", "Oak & Pine Co.")


def test_underpayment_leaves_the_invoice_open():
    """Partial payments are not modelled — the receivables total must not drift."""
    assert settlement.settleable(OPEN, income("Mesa Retail", 3000)) == []
    assert settlement.settleable(OPEN, income("Mesa Retail", 6400 - 5)) == []


def test_rounding_slip_of_a_dollar_still_settles():
    closed = settlement.settleable(OPEN, income("Mesa Retail", 6400.60))
    assert [r.vendor_or_customer for r in closed] == ["Mesa Retail"]


def test_pending_income_settles_nothing():
    """A promise of payment is not payment."""
    assert settlement.settleable(OPEN, income("Mesa Retail", 6400, status="pending")) == []


def test_expense_rows_never_settle_receivables():
    spend_row = Transaction(type="expense", vendor_or_customer="Mesa Retail", amount=6400,
                            transaction_date="2026-11-14", status="paid")
    assert settlement.settleable(OPEN, spend_row) == []


def test_paid_expense_closes_the_matching_payable():
    rows = [bill("Paper Mill Ltd", 2800, "2026-10-30")]
    closed = settlement.settleable(rows, spend("Paper Mill", 2800))
    assert [r.vendor_or_customer for r in closed] == ["Paper Mill Ltd"]


def test_paid_expense_leaves_a_half_paid_bill_open():
    rows = [bill("Paper Mill Ltd", 2800, "2026-10-30")]
    assert settlement.settleable(rows, spend("Paper Mill", 1400)) == []


def test_income_never_closes_a_payable():
    rows = [bill("Paper Mill Ltd", 2800, "2026-10-30")]
    assert settlement.settleable(rows, income("Paper Mill", 2800)) == []


def test_single_payment_can_clear_several_invoices():
    rows = [ar("Mesa Retail", 1000, "2026-09-01"), ar("Mesa Retail", 2000, "2026-10-01")]
    closed = settlement.settleable(rows, income("Mesa Retail", 3000))
    assert len(closed) == 2


def test_oldest_due_date_is_settled_first():
    rows = [ar("Mesa Retail", 5000, "2026-11-01"), ar("Mesa Retail", 5000, "2026-08-01")]
    closed = settlement.settleable(rows, income("Mesa Retail", 5000))
    assert [r.due_date for r in closed] == ["2026-08-01"]


def test_already_paid_rows_are_not_settled_twice():
    paid = ar("Mesa Retail", 6400, "2026-09-15", status="paid")
    assert settlement.settleable([paid], income("Mesa Retail", 6400)) == []


def test_blank_customer_names_never_match():
    rows = [ar("", 500, "2026-09-01")]
    assert settlement.settleable(rows, income("", 500)) == []


# --- a receivable is never born "paid" --------------------------------------

def test_new_receivable_is_pending_or_overdue_never_paid():
    from datetime import date
    today = date(2026, 11, 14)
    assert settlement.initial_status("ar", "2026-12-01", today) == "pending"
    assert settlement.initial_status("ar", "2026-09-15", today) == "overdue"
    assert settlement.initial_status("ar", "2026-11-14", today) == "pending"  # due today
    assert settlement.initial_status("ap", "2026-09-15", today) == "overdue"
    assert settlement.initial_status("ar", None, today) == "pending"


def test_income_and_expense_keep_their_own_status():
    assert settlement.initial_status("income", None) == "paid"
    assert settlement.initial_status("expense", None) == "paid"


def test_write_path_cannot_record_an_already_paid_invoice():
    from app import db
    row = {"type": "ar", "status": "paid", "due_date": "2026-09-15",
           "vendor_or_customer": "Mesa Retail"}
    assert db._apply_arap_status(row)["status"] == "overdue"
    assert db._apply_arap_status({"type": "ap", "status": "paid",
                                  "due_date": "2099-01-01"})["status"] == "pending"
    # Income/expense are always money that already moved.
    assert db._apply_arap_status({"type": "income", "status": "pending"})["status"] == "paid"


def test_income_and_expense_cannot_be_saved_as_pending():
    """Money recorded as income/expense already happened; unpaid money is AR/AP."""
    from app import db
    assert db._apply_arap_status({"type": "income", "status": "pending"})["status"] == "paid"
    assert db._apply_arap_status({"type": "expense", "status": "pending"})["status"] == "paid"
    assert db._apply_arap_status({"type": "income"})["status"] == "paid"


def test_writes_never_send_server_owned_columns():
    """created_at is NOT NULL with a DB default: sending null breaks the insert."""
    from app.db import write_row
    from app.models import Transaction

    row = write_row(Transaction(type="ar", amount=957, vendor_or_customer="Estelle Darcy",
                                transaction_date="2025-07-30", source="ocr",
                                document_id="d-1", created_at="2026-01-01T00:00:00Z"))
    assert "created_at" not in row
    assert "id" not in row
    # everything the user actually chose still goes through
    assert row["vendor_or_customer"] == "Estelle Darcy" and row["document_id"] == "d-1"
