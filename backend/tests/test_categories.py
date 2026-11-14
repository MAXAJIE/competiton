"""Category schema + best-fit classifier (backend/app/categories.py)."""
from app import categories as c


def test_every_type_has_a_catch_all():
    for tx_type, cats in c.BY_TYPE.items():
        assert cats, tx_type
        assert c._fallback(tx_type) in [x.label for x in cats]


def test_labels_are_unique_per_type():
    for tx_type, cats in c.BY_TYPE.items():
        labels = [x.label for x in cats]
        assert len(labels) == len(set(labels)), tx_type


def test_classifier_picks_obvious_categories():
    cases = [
        ("Tesco Extra", "Groceries"),
        ("Starbucks", "Dining & Cafés"),
        ("Shell Petrol Station", "Transport"),
        ("Netflix", "Subscriptions"),
        ("City Power", "Utilities"),
        ("Guardian Pharmacy", "Health"),
        ("Maxis Fibre", "Phone & Internet"),
        ("Northgate Props", "Housing"),
    ]
    for vendor, expected in cases:
        label, score, hits = c.classify(vendor, "", "expense")
        assert label == expected, (vendor, label, expected)
        assert score > 0 and hits


def test_classifier_income_and_ar():
    assert c.classify("Employer Payroll", "", "income")[0] == "Salary"
    assert c.classify("Acme Ltd", "invoice issued net 30", "ar")[0] == "Customer Invoice"


def test_unknown_vendor_falls_back_without_guessing():
    label, score, hits = c.classify("Qwerty Zzz", "", "expense")
    assert label == "Other" and score == 0 and hits == []


def test_coerce_maps_business_vocabulary_into_personal_schema():
    assert c.coerce("Office Supplies", "expense") == "Shopping"
    assert c.coerce("software", "expense") == "Subscriptions"
    assert c.coerce("unknown-blob", "expense", vendor="Shell petrol") == "Transport"
    assert c.coerce("", "income") == "Other Income"
    # already-valid labels pass through untouched
    assert c.coerce("Groceries", "expense") == "Groceries"


def test_every_coerced_label_is_in_taxonomy():
    junk = ["n/a", "Misc", "COGS", "Accounts Payable", "Utilities ", "food"]
    for raw in junk:
        for tx_type in c.BY_TYPE:
            assert c.is_valid(c.coerce(raw, tx_type), tx_type), (raw, tx_type)


def test_prompt_list_covers_the_taxonomy():
    listed = c.prompt_list("expense")
    for cat in c.EXPENSE:
        assert cat.label in listed


def test_taxonomy_payload_shape_for_ui():
    tax = c.taxonomy()
    assert set(tax) == {"expense", "income", "ar", "ap"}
    first = tax["expense"][0]
    assert set(first) == {"key", "label", "group", "description"}


def test_resolve_lets_classifier_overrule_a_vague_model_answer():
    # Vision model said "Work & Business"; the vendor is a stationery shop.
    label, changed, hits = c.resolve("Work & Business", "expense", "NORTHGATE SUPPLIES")
    assert label == "Shopping" and changed is True
    assert "supplies" in hits


def test_resolve_keeps_model_answer_when_keywords_are_weak():
    # No keyword evidence → trust the model as long as the label is valid.
    label, changed, _ = c.resolve("Pets", "expense", "Qwerty Zzz")
    assert label == "Pets" and changed is False


def test_resolve_repairs_out_of_schema_labels():
    label, changed, _ = c.resolve("Office Supplies", "expense", "Tesco Extra")
    assert label == "Groceries" and changed is True


def test_ar_is_an_income_category_for_customer_paybacks():
    from app import categories
    labels = categories.labels_for("income")
    assert "AR" in labels
    # It sits in its own UI section so it reads as a distinct thing to record.
    assert categories.taxonomy()["income"][0] == {
        "key": "ar", "label": "AR", "group": "AR",
        "description": "A customer paying back an invoice you already listed — "
                       "this settles that receivable",
    }


def test_payback_language_classifies_as_ar_but_new_sales_do_not():
    from app.categories import classify
    for text in ["customer paid back outstanding invoice",
                 "Mesa Retail repayment of arrears",
                 "balance owing settled invoice"]:
        assert classify(text, tx_type="income")[0] == "AR", text
    for text in ["monthly sales takings", "client payment for a new project",
                 "salary from employer"]:
        assert classify(text, tx_type="income")[0] != "AR", text
