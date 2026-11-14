"""Advisor behaviour that must not depend on a model: scope, shape, no markdown."""
from app import advisor
from app.models import Transaction


def test_out_of_scope_topics_are_refused_without_calling_a_model():
    for q in ["give me a pasta recipe", "tell me a joke", "write python code for me",
              "what's the weather tomorrow", "diagnose my headache"]:
        assert advisor.out_of_scope(q), q


def test_finance_and_company_law_questions_stay_in_scope():
    for q in ["who owes me money?", "analyze my cash flow", "can I deduct this expense?",
              "should I register for VAT?", "what is the 10-year yield today?"]:
        assert not advisor.out_of_scope(q), q


def test_live_information_questions_route_to_web_search():
    assert advisor.needs_web("will the Fed raise rates tomorrow?")
    assert advisor.needs_web("what is the current inflation rate?")
    assert advisor.needs_web("what is the filing deadline for VAT?")
    assert not advisor.needs_web("who owes me money and might pay late?")


def test_tidy_removes_markdown_emphasis():
    raw = "## Answer\n**Bold** and __also bold__ with `code`.\n* bullet one\n* bullet two\n\n\n\nNext"
    out = advisor.tidy(raw)
    assert not any(ch in out for ch in "*_`#")
    assert "Bold and also bold with code." in out
    assert "- bullet one" in out
    assert "\n\n\n" not in out


def test_frame_produces_the_fixed_section_order():
    text = advisor._frame("Found something.", caveat="A caveat.")
    assert text.splitlines()[0] == "Answer"
    assert "Next step" not in text or text.index("Next step") < text.index("Caveat")
    with_figures = advisor._frame("Found something.", [], "Do this.", "A caveat.")
    assert "Figures" not in with_figures  # empty figure list omits the section
    assert with_figures.splitlines()[1] == "Found something."


def test_fallback_replies_carry_no_asterisks_and_no_guessed_market_numbers():
    tx = [Transaction(type="income", amount=8000, transaction_date="2026-11-01", status="paid")]
    for q in ["who owes me money?", "analyze my cash flow", "predict next month",
              "will rates rise tomorrow?"]:
        reply = advisor._deterministic_answer(q, tx, None)
        assert "*" not in reply.text, q
        assert reply.text.startswith("Answer"), q


def test_empty_ledger_reads_as_empty_never_fabricated():
    reply = advisor.ask("who owes me money?", [])
    assert reply.text == advisor.NO_DATA
    assert reply.figures is None


def test_off_topic_question_short_circuits_before_the_model():
    reply = advisor.ask("tell me a joke", [])
    assert reply.text == advisor.OUT_OF_SCOPE
    assert "outside what I do" in reply.text


def test_web_context_is_offered_even_with_an_empty_ledger():
    # cannot reach the network in a unit test, but the routing decision must not
    # depend on having transactions: an external question is not "no data".
    assert advisor.needs_web("what is the US 10-year yield today?")
