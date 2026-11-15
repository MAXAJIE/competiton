import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Page } from "@/components/Reveal";
import { LegalDocumentView } from "@/components/LegalDocumentView";
import { PRIVACY } from "@/lib/legal";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — Cashflow" },
      {
        name: "description",
        content:
          "What CashMonitoring stores, who processes it, how long it is kept, how it is protected, and how to delete it.",
      },
    ],
  }),
  component: Privacy,
});

function Privacy() {
  return (
    <Page>
      <LegalDocumentView
        doc={PRIVACY}
        footer={
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <Link
              to="/terms"
              className="inline-flex items-center gap-1.5 font-medium text-indigo-600 hover:underline"
            >
              Terms of Use
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
