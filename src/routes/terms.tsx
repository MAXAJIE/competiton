import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Page } from "@/components/Reveal";
import { LegalDocumentView } from "@/components/LegalDocumentView";
import { TERMS } from "@/lib/legal";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Use — Cashflow" },
      {
        name: "description",
        content:
          "Terms of Use for CashMonitoring: a research and educational cash-flow project, for adults, provided as-is and not financial advice.",
      },
    ],
  }),
  component: Terms,
});

function Terms() {
  return (
    <Page>
      <LegalDocumentView
        doc={TERMS}
        footer={
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <Link
              to="/privacy"
              className="inline-flex items-center gap-1.5 font-medium text-indigo-600 hover:underline"
            >
              Privacy Policy
            </Link>
            <Link
              to="/login"
              className="inline-flex items-center gap-1.5 text-slate-600 hover:text-slate-900"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden /> Back to sign in
            </Link>
          </div>
        }
      />
    </Page>
  );
}
