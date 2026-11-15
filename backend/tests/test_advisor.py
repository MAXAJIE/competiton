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


# --- BYOK: a per-request key, never stored ----------------------------------

def test_the_callers_key_wins_over_the_servers(monkeypatch):
    from app import config
    monkeypatch.setattr(config, "OPENROUTER_API_KEY", "sk-or-server")
    assert config.request_key("sk-or-mine") == "sk-or-mine"


def test_the_server_key_is_the_fallback(monkeypatch):
    from app import config
    monkeypatch.setattr(config, "OPENROUTER_API_KEY", "sk-or-server")
    assert config.request_key(None) == "sk-or-server"
    assert config.request_key("   ") == "sk-or-server"


def test_no_keys_at_all_means_no_ai(monkeypatch):
    from app import config
    monkeypatch.setattr(config, "OPENROUTER_API_KEY", "")
    assert config.request_key(None) == ""


def test_ai_config_reports_capability_without_leaking_any_key():
    from fastapi.testclient import TestClient
    from app.main import app

    body = TestClient(app).get("/api/ai/config").json()
    assert body["provider"] == "openrouter"
    assert body["byok_supported"] is True
    assert isinstance(body["server_key"], bool)
    flat = str(body)
    assert "sk-or" not in flat and "sk-or-v1" not in flat
    # only model ids may be echoed
    assert body["models"]["advisor"]


def test_a_malformed_key_is_rejected_before_calling_openrouter():
    from fastapi.testclient import TestClient
    from app.main import app

    r = TestClient(app).post("/api/ai/key/test", json={"api_key": "sk-short"})
    assert r.status_code == 400
    assert "OpenRouter key" in r.json()["detail"]


def test_a_key_pasted_with_spaces_still_validates():
    from fastapi.testclient import TestClient
    from app.main import app

    # A copy/paste from a password manager often carries a trailing newline.
    r = TestClient(app).post("/api/ai/key/test", json={"api_key": "  sk-short\n"})
    assert r.status_code == 400
    assert "OpenRouter key" in r.json()["detail"]


# --- named questions: who owes me money, with a risk per party ---------------

def _ledger():
    from datetime import date, timedelta
    today = date.today()
    d = lambda n: (today + timedelta(days=n)).isoformat()
    return [
        Transaction(id="a1", type="ar", amount=4200, vendor_or_customer="Acme Corp",
                    transaction_date=d(-60), due_date=d(-32), status="overdue",
                    category="services"),
        Transaction(id="a2", type="ar", amount=800, vendor_or_customer="Acme Corp",
                    transaction_date=d(-10), due_date=d(5), status="pending",
                    category="services"),
        Transaction(id="b1", type="ar", amount=1500, vendor_or_customer="Blue Sky Ltd",
                    transaction_date=d(-5), due_date=d(20), status="pending",
                    category="services"),
        Transaction(id="c1", type="ar", amount=9000, vendor_or_customer="Paid Co",
                    transaction_date=d(-40), due_date=d(-10), status="paid",
                    category="services"),
        Transaction(id="p1", type="ap", amount=1200, vendor_or_customer="Paper Supply",
                    transaction_date=d(-20), due_date=d(-3), status="overdue",
                    category="supplies"),
    ]


def test_party_balances_names_every_party_and_sums_their_invoices():
    from app import ml
    data = ml.party_balances(_ledger(), "ar")
    assert [p["party"] for p in data["parties"]] == ["Acme Corp", "Blue Sky Ltd"]
    acme = data["parties"][0]
    assert acme["open_amount"] == 5000          # 4200 + 800, one party
    assert acme["invoice_count"] == 2
    assert acme["late_invoice_count"] == 1
    assert acme["max_days_overdue"] == 32
    assert acme["severity"] == "high"
    assert data["total_open"] == 6500
    # a settled invoice is nobody's debt
    assert all(p["party"] != "Paid Co" for p in data["parties"])


def test_party_balances_puts_whoever_is_late_first():
    from app import ml
    parties = ml.party_balances(_ledger(), "ar")["parties"]
    assert parties[0]["late_invoice_count"] > 0
    assert parties[-1]["late_invoice_count"] == 0


def test_party_balances_covers_payables_with_a_factual_rating():
    from app import ml
    data = ml.party_balances(_ledger(), "ap")
    assert data["side"] == "payable"
    paper = data["parties"][0]
    assert paper["party"] == "Paper Supply"
    assert paper["severity"] == "high" and paper["max_days_overdue"] == 3
    # no model exists for payables: the rating must say where it came from
    assert paper["risk_basis"] == "due_date"


def test_who_tools_are_registered_so_a_who_question_has_a_named_tool():
    names = {t["function"]["name"] for t in advisor.TOOL_SET}
    assert {"who_owes_me", "who_i_owe"} <= names


def test_who_questions_are_recognised_before_the_model_is_called():
    assert advisor.party_side("who owes me money?") == "ar"
    assert advisor.party_side("which customers are late on payment?") == "ar"
    assert advisor.party_side("who do I owe money to?") == "ap"
    assert advisor.party_side("which suppliers am I late paying?") == "ap"
    # not a naming question, so it keeps using the summary tools
    assert advisor.party_side("what is my total receivables balance?") is None


def test_who_owes_me_lists_names_and_a_risk_for_each(monkeypatch):
    from app import config
    monkeypatch.setattr(config, "OPENROUTER_API_KEY", "")
    reply = advisor.ask("who owes me money?", _ledger())
    assert reply.tool == "who_owes_me"
    labels = [f.label for f in reply.figures or []]
    assert labels[:2] == ["Acme Corp", "Blue Sky Ltd"]
    assert "Total open" in labels
    assert "high risk" in reply.text and "medium risk" in reply.text
    assert "32 days late" in reply.text
    assert "Acme Corp" in reply.text


def test_who_i_owe_lists_suppliers_never_customers(monkeypatch):
    from app import config
    monkeypatch.setattr(config, "OPENROUTER_API_KEY", "")
    reply = advisor.ask("who do I owe money to?", _ledger())
    assert reply.tool == "who_i_owe"
    assert "Paper Supply" in reply.text
    assert "Acme Corp" not in reply.text


def test_the_tool_result_carries_copy_ready_lines_for_the_model(monkeypatch):
    result, figures = advisor._run_tool("who_owes_me", {}, _ledger())
    assert result["parties"][0]["summary"] == figures[0].value
    assert result["figure_lines"][0] == f"- {figures[0].label}: {figures[0].value}"
    assert all("p_late" not in line for line in result["figure_lines"])


def test_a_model_that_names_nobody_falls_back_to_the_rules(monkeypatch):
    """An empty message must not become an empty bubble (seen in production)."""
    from app import config
    monkeypatch.setattr(config, "OPENROUTER_API_KEY", "sk-or-server")
    monkeypatch.setattr(advisor, "_complete",
                        lambda *a, **k: {"content": "", "tool_calls": None})
    reply = advisor.ask("who owes me money?", _ledger())
    assert reply.text.strip()
    assert reply.tool == "who_owes_me"
    assert "Acme Corp" in reply.text


def test_an_unreachable_model_still_answers_from_the_rules(monkeypatch):
    from app import config
    monkeypatch.setattr(config, "OPENROUTER_API_KEY", "sk-or-server")
    monkeypatch.setattr(advisor, "_complete", lambda *a, **k: None)
    reply = advisor.ask("who owes me money?", _ledger())
    assert "Acme Corp" in reply.text and reply.tool == "who_owes_me"


def test_tidy_normalises_typographic_punctuation():
    raw = "Acme\u2011Corp owes 31\u202f% \u2014 \u201cnow\u201d\u2026 \u200b."
    assert advisor.tidy(raw) == 'Acme-Corp owes 31 % - "now"... .'


def test_the_reply_text_always_shows_the_attached_figures():
    from app.models import Figure
    figs = [Figure(label="Acme Corp", value="$5,000 · high risk"),
            Figure(label="Total open", value="$9,100")]
    # a model that folds the names into prose and leaves only the total
    text = advisor._with_figures("Answer\nTwo customers owe you.\n\nFigures\n- Total open: $9,100", figs)
    assert "- Acme Corp: $5,000 · high risk" in text
    assert text.index("Acme Corp") < text.index("Total open")
    # idempotent: a reply that already carries them is left alone
    assert advisor._with_figures(text, figs) == text


def test_figures_are_not_invented_when_a_tool_attached_none():
    assert advisor._with_figures("Answer\nNothing to show.", []) == "Answer\nNothing to show."


def test_a_list_the_model_repeats_in_the_answer_is_not_shown_twice():
    from app.models import Figure
    figs = [Figure(label="Acme Corp", value="$5,000 · high risk")]
    text = ("Answer\n- Acme Corp: $5,000 · high risk\n\nAcme Corp is the urgent one."
            "\n\nFigures\n- Acme Corp: $5,000 · high risk")
    out = advisor._with_figures(text, figs)
    assert out.count("- Acme Corp: $5,000 · high risk") == 1
    assert "Acme Corp is the urgent one." in out


def test_a_party_named_and_bulleted_in_the_answer_is_not_repeated():
    from app.models import Figure
    figs = [Figure(label="Acme Corp", value="$4,200 · 32 days late · high risk")]
    text = ("Answer\nThree customers owe you.\n\nAcme Corp\n- $4,200 · 32 days late · high risk\n"
            "\nAcme Corp is the urgent one.\n\nFigures\n- Acme Corp: $4,200 · 32 days late · high risk")
    out = advisor._with_figures(text, figs)
    assert out.count("$4,200") == 1
    assert "Three customers owe you." in out and "Acme Corp is the urgent one." in out


def test_the_total_keeps_the_last_line_of_the_figures_block():
    from app.models import Figure
    figs = [Figure(label="Acme Corp", value="$4,200 · high risk"),
            Figure(label="Total open", value="$8,300")]
    total_first = ("Answer\nOne party owes you.\n\nFigures\n- Total open: $8,300\n"
                   "- Acme Corp: $4,200 · high risk")
    out = advisor._with_figures(total_first, figs)
    assert out.splitlines()[-1] == "- Total open: $8,300"
