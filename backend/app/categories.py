"""Category schema (SKILL.md §5 `category`) + best-fit classifier.

Designed for a normal person / sole trader, NOT company accounting: everyday
labels (Groceries, Dining, Transport, Subscriptions) instead of Payroll/COGS/
Accounts-Payable-department vocabulary.

Two jobs:
1. ONE taxonomy shared by OCR prompts, manual entry and the API
   (`GET /api/categories`) so the three can never drift apart.
2. A deterministic keyword classifier that always returns a category in the
   taxonomy — used to repair whatever a model invents ("Office Supplies" →
   "Shopping") and to auto-suggest a category from the vendor name.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Category:
    key: str          # stable id, e.g. "groceries"
    label: str        # what is stored in transactions.category
    group: str        # UI grouping
    description: str
    keywords: tuple[str, ...] = field(default_factory=tuple)

    def as_dict(self) -> dict:
        return {"key": self.key, "label": self.label, "group": self.group,
                "description": self.description}


# --- Expense: everyday spending for one person / one household --------------
EXPENSE: tuple[Category, ...] = (
    Category("housing", "Housing", "Home", "Rent or mortgage payment",
             ("rent", "mortgage", "landlord", "tenancy", "lease", "property",
              "properties", "props", "realty", "estate", "apartment", "condo",
              "housing", "maintenance fee", "strata")),
    Category("utilities", "Utilities", "Home", "Electricity, water, gas, council charges",
             ("electric", "electricity", "power", "water", "gas", "utility", "utilities",
              "city power", "heating", "sewer")),
    Category("telecom", "Phone & Internet", "Home", "Mobile, broadband, data plans",
             ("internet", "broadband", "fibre", "fiber", "wifi", "mobile", "celcom",
              "maxis", "digi", "telco", "phone bill", "data plan", "unifi")),
    Category("groceries", "Groceries", "Everyday", "Supermarket and food shopping",
             ("grocer", "groceries", "supermarket", "tesco", "aeon", "lotus", "market",
              "mini market", "fresh", "produce", "butcher", "vegetables")),
    Category("dining", "Dining & Cafés", "Everyday", "Restaurants, cafés, takeaway, food delivery",
             ("restaurant", "cafe", "café", "coffee", "starbucks", "mcdonald", "kfc",
              "burger", "pizza", "food", "grabfood", "foodpanda", "takeaway", "takeout",
              "bistro", "bakery", "lunch", "dinner")),
    Category("transport", "Transport", "Everyday", "Fuel, public transport, parking, ride-hailing",
             ("petrol", "fuel", "gas station", "diesel", "shell", "petronas", "caltex",
              "taxi", "grab", "uber", "bus", "train", "mrt", "lrt", "toll", "parking",
              "transit", "transport", "fare")),
    Category("vehicle", "Vehicle", "Everyday", "Car or bike servicing, tyres, road tax",
             ("service", "servicing", "workshop", "tyre", "tire", "road tax", "insurance car",
              "car wash", "spare part", "motorbike", "vehicle", "car")),
    Category("health", "Health", "Wellbeing", "Doctor, dentist, pharmacy, clinic, therapy",
             ("clinic", "hospital", "doctor", "dentist", "dental", "pharmacy", "medicine",
              "medical", "health", "optician", "glasses", "therapy", "physio", "vaccine")),
    Category("insurance", "Insurance", "Wellbeing", "Life, health, home or travel insurance premiums",
             ("insurance", "premium", "policy", "coverage", "takaful", "assurance")),
    Category("education", "Education", "Wellbeing", "School fees, courses, books, tuition",
             ("school", "tuition", "course", "class", "book", "textbook", "university",
              "college", "exam", "workshop fee", "training", "udemy", "coursera")),
    Category("shopping", "Shopping", "Everyday", "Clothes, electronics, household goods",
             ("shop", "store", "mall", "clothing", "apparel", "shirt", "shoes", "lazada",
              "shopee", "amazon", "electronics", "furniture", "ikea", "hardware",
              "household", "supplies", "stationery", "toys")),
    Category("entertainment", "Entertainment", "Leisure", "Cinema, games, hobbies, nights out",
             ("cinema", "movie", "game", "gaming", "steam", "playstation", "concert",
              "ticket", "hobby", "bowling", "karaoke", "entertainment", "museum")),
    Category("subscriptions", "Subscriptions", "Leisure", "Streaming, apps, memberships, software",
             ("netflix", "spotify", "youtube", "disney", "subscription", "membership",
              "cloud", "software", "app store", "google one", "icloud", "adobe",
              "microsoft 365", "cloudware", "saas", "annual plan", "monthly plan")),
    Category("travel", "Travel", "Leisure", "Flights, hotels, holidays, visas",
             ("flight", "airline", "airasia", "hotel", "booking", "airbnb", "agoda",
              "travel", "holiday", "vacation", "visa", "passport", "resort", "tour")),
    Category("personal_care", "Personal Care", "Wellbeing", "Haircut, gym, skincare, toiletries",
             ("salon", "barber", "haircut", "spa", "gym", "fitness", "yoga", "skincare",
              "cosmetic", "toiletries", "personal care", "massage")),
    Category("family", "Family & Childcare", "Home", "Daycare, kids' needs, allowances to family",
             ("daycare", "nursery", "babysit", "childcare", "kindergarten", "kids",
              "children", "allowance", "family", "school bus", "milk powder", "diaper")),
    Category("pets", "Pets", "Home", "Pet food, vet, grooming",
             ("pet", "vet", "veterinary", "petfood", "kibble", "grooming", "cat", "dog",
              "aquarium")),
    Category("home_repairs", "Home & Repairs", "Home", "Maintenance, repairs, tools, cleaning",
             ("repair", "maintenance", "plumber", "electrician", "handyman", "cleaning",
              "laundry", "paint", "renovation", "pest control", "aircond", "aircon")),
    Category("debt", "Debt & Loans", "Money", "Loan repayments, credit card interest, instalments",
             ("loan", "repayment", "instalment", "installment", "credit card", "interest",
              "hire purchase", "financing", "debt", "borrow")),
    Category("fees", "Bank Fees", "Money", "Bank charges, transfer fees, ATM fees, late fees",
             ("fee", "fees", "charge", "charges", "service charge", "atm", "transfer fee",
              "late payment", "penalty", "admin fee", "stamp duty")),
    Category("taxes", "Taxes", "Money", "Income tax, property tax, road tax, government charges",
             ("tax", "lhdn", "inland revenue", "irs", "gst", "sst", "vat", "customs",
              "government", "municipal")),
    Category("gifts", "Gifts & Donations", "Leisure", "Presents, charity, zakat, tithes",
             ("gift", "present", "donation", "charity", "zakat", "tithe", "fundraiser",
              "ngo", "alms")),
    Category("business", "Work & Business", "Work", "Tools, stock, ads, work travel for a side business",
             ("stock", "inventory", "supplier", "wholesale", "advertising", "ads", "marketing",
              "client", "freelance expense", "business", "printing", "packaging",
              "shipping", "courier", "booth", "licence", "license")),
    Category("savings", "Savings & Investments", "Money", "Money moved to savings, unit trusts, EPF",
             ("savings", "save", "investment", "invest", "unit trust", "asb", "epf", "kwsp",
              "fixed deposit", "stocks", "broker", "crypto")),
    Category("other_expense", "Other", "Everyday", "Anything that fits no other category",
             ()),
)

# --- Income ----------------------------------------------------------------
INCOME: tuple[Category, ...] = (
    Category("salary", "Salary", "Work", "Regular wages from an employer",
             ("salary", "payroll", "wages", "payslip", "employer", "monthly pay", "bonus")),
    Category("business_income", "Business Income", "Work", "Sales or takings from your own business",
             ("sales", "takings", "invoice paid", "customer payment", "pos", "store sales",
              "business income", "client payment")),
    Category("freelance", "Freelance & Side Work", "Work", "Gigs, consulting, commissions",
             ("freelance", "gig", "consult", "commission", "contract", "project fee",
              "upwork", "fiverr", "royalty")),
    Category("interest", "Interest & Dividends", "Money", "Bank interest, dividends, unit trust payouts",
             ("interest", "dividend", "payout", "unit trust", "asb", "fd", "fixed deposit",
              "investment return", "profit share")),
    Category("refunds", "Refunds & Reimbursements", "Money", "Money returned or claimed back",
             ("refund", "reimburse", "reimbursement", "claim", "return", "cashback",
              "rebate", "insurance payout")),
    Category("gifts_received", "Gifts Received", "Money", "Presents, family support, inheritances",
             ("gift", "present", "family support", "inheritance", "angpao", "red packet",
              "donation received")),
    Category("benefits", "Benefits & Allowances", "Money", "Pensions, government aid, allowances",
             ("pension", "benefit", "allowance", "subsidy", "welfare", "bantuan", "grant",
              "unemployment")),
    Category("other_income", "Other Income", "Money", "Anything that fits no other category",
             ()),
)

# --- Receivables (money owed TO you) ---------------------------------------
RECEIVABLE: tuple[Category, ...] = (
    Category("customer_invoice", "Customer Invoice", "Receivable", "Invoice you issued to a customer",
             ("invoice", "customer", "client", "bill to", "net 30")),
    Category("loan_given", "Money Lent Out", "Receivable", "Someone owes you a personal loan",
             ("loan", "borrow", "lent", "friend", "family")),
    Category("other_receivable", "Other Receivable", "Receivable", "Any other money owed to you",
             ()),
)

# --- Payables (money YOU owe) ----------------------------------------------
PAYABLE: tuple[Category, ...] = (
    Category("supplier_bill", "Supplier Bill", "Payable", "Bill from a supplier or vendor",
             ("bill", "invoice", "supplier", "vendor", "wholesale")),
    Category("rent_due", "Rent Due", "Payable", "Rent owed but not yet paid",
             ("rent", "landlord", "tenancy")),
    Category("loan_instalment", "Loan Instalment Due", "Payable", "Upcoming loan or credit instalment",
             ("loan", "instalment", "installment", "credit card", "financing", "hire purchase")),
    Category("other_payable", "Other Payable", "Payable", "Any other money you owe",
             ()),
)

BY_TYPE: dict[str, tuple[Category, ...]] = {
    "expense": EXPENSE,
    "income": INCOME,
    "ar": RECEIVABLE,
    "ap": PAYABLE,
}

ALL_CATEGORIES: tuple[Category, ...] = EXPENSE + INCOME + RECEIVABLE + PAYABLE

# Model output that does not match a label exactly is mapped here first, so
# business-style answers ("Office Supplies", "Payroll") land somewhere sensible.
_SYNONYMS: dict[str, str] = {
    "office supplies": "Shopping",
    "supplies": "Shopping",
    "equipment": "Shopping",
    "miscellaneous": "Other",
    "misc": "Other",
    "other": "Other",
    "payroll": "Salary",
    "wages": "Salary",
    "utilities": "Utilities",
    "utility": "Utilities",
    "food": "Dining & Cafés",
    "meals": "Dining & Cafés",
    "restaurant": "Dining & Cafés",
    "groceries": "Groceries",
    "grocery": "Groceries",
    "rent": "Housing",
    "mortgage": "Housing",
    "fuel": "Transport",
    "transportation": "Transport",
    "software": "Subscriptions",
    "subscription": "Subscriptions",
    "saas": "Subscriptions",
    "medical": "Health",
    "healthcare": "Health",
    "education": "Education",
    "training": "Education",
    "travel": "Travel",
    "entertainment": "Entertainment",
    "insurance": "Insurance",
    "bank charges": "Bank Fees",
    "bank fees": "Bank Fees",
    "charges": "Bank Fees",
    "tax": "Taxes",
    "taxes": "Taxes",
    "donation": "Gifts & Donations",
    "charity": "Gifts & Donations",
    "sales": "Business Income",
    "revenue": "Business Income",
    "invoice": "Customer Invoice",
    "bill": "Supplier Bill",
}


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9& ]+", " ", (text or "").lower()).strip()


def labels_for(tx_type: str) -> list[str]:
    return [c.label for c in BY_TYPE.get(tx_type, EXPENSE)]


def taxonomy() -> dict[str, list[dict]]:
    """Everything the UI needs, grouped by transaction type."""
    return {k: [c.as_dict() for c in v] for k, v in BY_TYPE.items()}


def is_valid(label: str, tx_type: str) -> bool:
    return (label or "").strip() in labels_for(tx_type)


def classify(vendor: str = "", text: str = "", tx_type: str = "expense",
             amount: float | None = None) -> tuple[str, float, list[str]]:
    """Pick the best-fit category from the taxonomy.

    Returns (label, score, matched_keywords). Always returns a valid label for
    the type — falls back to the type's catch-all ("Other" / "Other Income" …).
    """
    cats = BY_TYPE.get(tx_type, EXPENSE)
    haystack = _norm(f"{vendor} {text}")
    best: Category | None = None
    best_score = 0.0
    best_hits: list[str] = []

    for cat in cats:
        score = 0.0
        hits: list[str] = []
        for kw in cat.keywords:
            k = _norm(kw)
            if not k:
                continue
            # multi-word phrases are stronger evidence than single tokens
            weight = 1.6 if " " in k else 1.0
            if re.search(rf"(?<![a-z0-9]){re.escape(k)}(?![a-z0-9])", haystack):
                score += weight + 0.1 * len(k)
                hits.append(kw)
        if score > best_score:
            best, best_score, best_hits = cat, score, hits

    if best is None:
        return _fallback(tx_type), 0.0, []
    confidence = min(0.95, 0.35 + best_score / 6)
    return best.label, round(confidence, 2), best_hits[:4]


def _fallback(tx_type: str) -> str:
    return {"expense": "Other", "income": "Other Income",
            "ar": "Other Receivable", "ap": "Other Payable"}.get(tx_type, "Other")


def coerce(raw: str, tx_type: str = "expense", vendor: str = "",
           text: str = "") -> str:
    """Map any label (model output, legacy data, free text) onto the taxonomy.

    Order: exact label → synonym → classifier over vendor/text → catch-all.
    """
    label = (raw or "").strip()
    if label and is_valid(label, tx_type):
        return label
    if label:
        lower = label.lower()
        cats = BY_TYPE.get(tx_type, EXPENSE)
        for c in cats:
            if c.key == lower or c.label.lower() == lower:
                return c.label
        if lower in _SYNONYMS:
            candidate = _SYNONYMS[lower]
            if is_valid(candidate, tx_type):
                return candidate
        guess, score, _ = classify(vendor, f"{label} {text}", tx_type)
        if score > 0:
            return guess
    return classify(vendor, text, tx_type)[0] if (vendor or text) else _fallback(tx_type)


def prompt_list(tx_type: str) -> str:
    """Category list injected into the OCR prompt so the model picks from it."""
    cats = BY_TYPE.get(tx_type, EXPENSE)
    return "; ".join(f"{c.label} ({c.description})" for c in cats)


# How sure the keyword classifier must be before it overrules a model's answer.
OVERRULE_THRESHOLD = 0.6


def resolve(model_label: str, tx_type: str = "expense", vendor: str = "",
            text: str = "") -> tuple[str, bool, list[str]]:
    """Decide the final category: the classifier wins when it is clearly surer.

    A vision model often answers with a defensible-but-vague label ("Work &
    Business" for a stationery shop). When the vendor/description matches a
    category's keywords strongly, that deterministic match is more reliable and
    reproducible than the model's guess.

    Returns (label, changed_from_model, matched_keywords).
    """
    label, score, hits = classify(vendor, text, tx_type)
    model_clean = (model_label or "").strip()
    strong = score >= OVERRULE_THRESHOLD

    if not model_clean or not is_valid(model_clean, tx_type):
        # Out-of-schema (or missing) label: strong keyword evidence wins,
        # otherwise fall back to synonym mapping so the row still lands somewhere.
        if strong:
            return label, True, hits
        coerced = coerce(model_clean, tx_type, vendor, text)
        return coerced, coerced.lower() != model_clean.lower(), hits

    if strong and label != model_clean:
        return label, True, hits
    return model_clean, False, hits
