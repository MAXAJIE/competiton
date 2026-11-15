// The legal text, kept as data rather than JSX so the same words can be shown
// on /terms, /privacy, linked from the login form, summarised in Settings and
// asserted by tests. Version numbers must match backend/app/config.py
// (TERMS_VERSION / PRIVACY_VERSION): the signup endpoint rejects an acceptance
// that names an older version, so a stale tab cannot accept text it never saw.
//
// This is a student/competition project. The wording is deliberately plain and
// says so: research and educational use only, no financial advice, 18+.

export const TERMS_VERSION = "1.0";
export const PRIVACY_VERSION = "1.0";
export const MIN_AGE = 18;
export const EFFECTIVE_DATE = "1 November 2026";
export const CONTACT_EMAIL = "support@cashmonitoring.app";

/** Retention defaults. Mirrors backend/app/config.py; /api/legal is the
 *  authority when the backend is reachable (see legal-config API). */
export const RETENTION = {
  transactionsDays: 1095,
  documentsDays: 180,
  maxTransactions: 5000,
  maxDocuments: 500,
} as const;

export interface LegalSection {
  id: string;
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
}

export interface LegalDocument {
  title: string;
  version: string;
  effective: string;
  summary: string;
  sections: LegalSection[];
}

const RESEARCH_NOTE =
  "CashMonitoring is a research and educational project built to demonstrate cash-flow " +
  "monitoring, document extraction and applied machine learning. It is not a bank, a " +
  "bookkeeping service, an accountant, a tax adviser or an investment adviser, and nothing " +
  "in the app is financial, legal, tax or investment advice.";

export const TERMS: LegalDocument = {
  title: "Terms of Use",
  version: TERMS_VERSION,
  effective: EFFECTIVE_DATE,
  summary: RESEARCH_NOTE,
  sections: [
    {
      id: "purpose",
      heading: "1. Purpose of this service",
      paragraphs: [RESEARCH_NOTE],
      bullets: [
        "Figures, forecasts and risk flags are demonstrations of method, not recommendations. Do not make financial decisions on them alone.",
        "The service may be changed, interrupted or withdrawn at any time, without notice, because it is an educational project rather than a commercial product.",
        "There is no service-level agreement, no availability guarantee and no support commitment.",
      ],
    },
    {
      id: "eligibility",
      heading: "2. Who may use it (18+)",
      paragraphs: [
        "You must be at least 18 years old to create an account. Registration asks you to affirm " +
          "this explicitly, and the affirmation is recorded with your acceptance of these Terms.",
        "If you are under 18, do not register. You may still explore the demo in guest mode, " +
          "which stores nothing on a server.",
      ],
    },
    {
      id: "account",
      heading: "3. Your account",
      bullets: [
        "Keep your password private and use an address you control. You are responsible for activity under your account.",
        "One person per account; do not share credentials or use another person's workspace.",
        "Provide accurate information, and only enter data you have the right to enter.",
        "We may suspend or remove an account that is used for abuse, unlawful content, or attempts to break the service's security or rate limits.",
      ],
    },
    {
      id: "acceptable-use",
      heading: "4. Acceptable use",
      paragraphs: ["You agree not to:"],
      bullets: [
        "upload malware, or files that are not receipts, invoices, bank statements or similar financial documents;",
        "attempt to access another user's data, probe the API for weaknesses, or bypass authentication, rate limits or the review step that confirms scanned entries;",
        "scrape, resell or redistribute the service or its model outputs as if they were your own product;",
        "use the service for money laundering, fraud, or any purpose that is illegal where you live.",
      ],
    },
    {
      id: "ai",
      heading: "5. AI features and their limits",
      paragraphs: [
        "Document scanning and the advisor call third-party language models through OpenRouter. " +
          "Model output can be wrong, incomplete or invented, and you are shown a review screen " +
          "before any scanned entry is saved — use it.",
        "The advisor may only quote figures produced by the app's own calculation layer, but you " +
          "should still verify anything that matters against your own records.",
        "When AI features are used, the text or image needed for that request is sent to the model " +
          "provider (see the Privacy Policy).",
      ],
    },
    {
      id: "your-data",
      heading: "6. Your data and your keys",
      bullets: [
        "The ledger, scanned documents and settings you create belong to you. We claim no ownership over them and use them only to run the features you ask for.",
        "An OpenRouter API key you add is stored only in your browser and sent with your own requests. It is never written to our database, logs or backups.",
        "You can delete your transactions and scans, or your whole account, at any time from Settings. Deletion is described in the Privacy Policy and is irreversible.",
        "Data older than the retention window is deleted automatically; the app does not hoard what it no longer needs.",
      ],
    },
    {
      id: "availability",
      heading: "7. Availability and changes",
      paragraphs: [
        "Features may be added, altered or removed as the project evolves. Where a change affects " +
          "these Terms or data handling, the version number changes and you will be asked to accept " +
          "the new version the next time you sign in.",
        "Continuing to use the service after a change means you accept the updated Terms.",
      ],
    },
    {
      id: "liability",
      heading: "8. No warranty, limitation of liability",
      paragraphs: [
        "The service is provided \u201cas is\u201d and \u201cas available\u201d, without warranties of " +
          "any kind, express or implied, including fitness for a particular purpose, accuracy or " +
          "non-infringement.",
        "To the fullest extent permitted by law, the project's authors and contributors are not " +
          "liable for any indirect, incidental, special or consequential loss, nor for lost profits, " +
          "lost data or business interruption, arising from your use of the service.",
        "Because this is a free educational project, nothing here creates a professional or " +
          "fiduciary relationship, and no reliance should be placed on the output for financial, tax " +
          "or legal decisions.",
      ],
    },
    {
      id: "termination",
      heading: "9. Ending your use",
      paragraphs: [
        "You may delete your account at any time from Settings \u2192 Data & privacy. Deleting the " +
          "account removes your rows, your uploaded files and the account itself.",
        "We may terminate access for a breach of these Terms, or if continuing to operate the " +
          "project is no longer possible.",
      ],
    },
    {
      id: "law",
      heading: "10. Contact",
      paragraphs: [
        `Questions about these Terms can go to ${CONTACT_EMAIL}. This project is provided for ` +
          "education and research; where a dispute cannot be resolved informally, the law of the " +
          "operator's place of residence applies.",
      ],
    },
  ],
};

export const PRIVACY: LegalDocument = {
  title: "Privacy Policy",
  version: PRIVACY_VERSION,
  effective: EFFECTIVE_DATE,
  summary:
    "Short version: we store the minimum needed to run a cash-monitoring workspace, we keep it " +
    "for a limited time, we never sell it or show ads, and you can erase it yourself at any time.",
  sections: [
    {
      id: "who",
      heading: "1. Who runs this service",
      paragraphs: [
        "CashMonitoring is a research and educational project. The operator of the deployment you " +
          `are using is the data controller for the workspace you create. Contact: ${CONTACT_EMAIL}.`,
      ],
    },
    {
      id: "collect",
      heading: "2. What we collect and why",
      bullets: [
        "Account: your email address and a hashed password, handled by Supabase Auth. Used to sign you in and to keep your ledger separate from everyone else's.",
        "Ledger: the transactions you enter or confirm — type, amount, dates, category, counterparty. Used to compute balances, runway, forecasts and risk flags.",
        "Scans: the images or PDFs you upload, the extracted fields and your confirmation. Used to read a document once, then to show you what was read. Only confirmed entries become transactions.",
        "Settings: your runway threshold, overdue-invoice threshold, report email and warning preference. Used to generate the alerts you asked for.",
        "Consent record: that you affirmed you are 18+ and accepted the Terms and Privacy Policy, with the versions, a timestamp and a one-way hash of the IP address used.",
        "Operational logs: technical errors. They are redacted of keys and tokens before being written.",
      ],
      paragraphs: [
        "We do not collect advertising identifiers, we do not run analytics or tracking pixels, " +
          "and we do not build a profile of you for marketing. The only browser storage used is " +
          "the session token and your local AI settings.",
      ],
    },
    {
      id: "ai-key",
      heading: "3. Your own AI key (BYOK)",
      paragraphs: [
        "If you choose to use your own OpenRouter key instead of the server's, it is stored in " +
          "your browser's local storage and sent with your own AI requests in a request header. It " +
          "is not written to our database, our logs or our backups, and it is not readable by other " +
          "users. Removing it from Settings deletes it from that browser immediately.",
      ],
    },
    {
      id: "sharing",
      heading: "4. Who else sees the data",
      bullets: [
        "Supabase — database, authentication and file storage for the workspace (hosting and processors may be in another region).",
        "OpenRouter and the model provider it routes to — receives the question or the document image only when you use an AI feature.",
        "Resend — sends the report email, and only when you press \u201csend test report\u201d.",
        "Market data sources — public indicators and headlines are fetched by a scheduled job; no user data is sent to them.",
      ],
      paragraphs: [
        "We do not sell personal data, we do not share it with advertisers, and we do not disclose " +
          "it except to these processors, or where the law requires it and we are permitted to say so.",
      ],
    },
    {
      id: "retention",
      heading: "5. How long we keep it",
      bullets: [
        `Transactions are deleted after ${RETENTION.transactionsDays} days, and an account is capped at ${RETENTION.maxTransactions} rows — beyond that the oldest are removed.`,
        `Uploaded scans are deleted after ${RETENTION.documentsDays} days, and an account is capped at ${RETENTION.maxDocuments} documents.`,
        "The consent record is kept for as long as the account exists, so we can show what you accepted.",
        "Deleting your account removes your rows, your uploaded files and the account itself.",
      ],
      paragraphs: [
        "Retention is enforced automatically by the backend, not by a person remembering to clean up. " +
          "Backups taken by the hosting provider are rotated on the provider's own schedule and may " +
          "retain a deleted record for a short period after deletion.",
      ],
    },
    {
      id: "rights",
      heading: "6. Your choices and rights",
      bullets: [
        "Erase data: Settings \u2192 Data & privacy \u2192 \u201cDelete all my data\u201d clears transactions, scans and settings but keeps the account.",
        "Erase everything: \u201cDelete my account\u201d removes the account as well. It is irreversible.",
        "Guest mode: \u201cexplore as guest\u201d keeps the demo ledger in the browser tab and never sends it to a server.",
        "Depending on where you live you may also have the right to access, correct, restrict or object to processing, and to complain to your data-protection authority.",
      ],
    },
    {
      id: "security",
      heading: "7. How it is protected",
      bullets: [
        "Row level security is enabled on every table, so a database key in the browser cannot read another account's rows.",
        "Every API request that touches your data requires your signed-in token and is filtered by user id on the server.",
        "Traffic is carried over HTTPS; API keys and tokens are redacted from error messages and logs.",
        "Abuse is bounded by per-route rate limits, upload type and size checks, strict input validation and text cleaning before anything is stored.",
        "Scanned entries never become transactions until you confirm them.",
      ],
      paragraphs: [
        "No system is perfectly secure. This is a student project, so treat it accordingly and do " +
          "not upload documents you would not be comfortable losing, and never upload another " +
          "person's identity documents.",
      ],
    },
    {
      id: "children",
      heading: "8. Children",
      paragraphs: [
        `The service is for adults. It is not directed to anyone under ${MIN_AGE}, registration ` +
          "requires an age affirmation, and an account found to belong to a minor will be removed.",
      ],
    },
    {
      id: "transfers",
      heading: "9. Where data is processed",
      paragraphs: [
        "Our processors may store data outside your country. Where that happens, the processor's " +
          "own safeguards apply to the transfer. AI requests are only made when you use an AI " +
          "feature, and only with the content needed for that request.",
      ],
    },
    {
      id: "changes",
      heading: "10. Changes to this policy",
      paragraphs: [
        "If this policy changes materially, its version number changes and you will be asked to " +
          "accept the new version on your next sign-in. The effective date at the top always shows " +
          "which text is current.",
      ],
    },
  ],
};

export const LEGAL_DOCUMENTS = { terms: TERMS, privacy: PRIVACY } as const;
