import type { ReactNode } from "react";
import { FileText, ShieldCheck } from "lucide-react";
import type { LegalDocument } from "@/lib/legal";

/**
 * One renderer for both legal documents.
 *
 * The text lives in src/lib/legal.ts so /terms and /privacy cannot drift from
 * what the signup form asks people to accept, and so a test can assert that the
 * research-only disclaimer and the deletion rights are actually present.
 */
export function LegalDocumentView({ doc, footer }: { doc: LegalDocument; footer?: ReactNode }) {
  return (
    <article className="mx-auto max-w-3xl">
      <header className="border-b border-slate-200 pb-6">
        <p className="eyebrow inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5">
          <FileText className="h-3.5 w-3.5 text-slate-500" aria-hidden />
          Version {doc.version} · effective {doc.effective}
        </p>
        <h1 className="mt-4 text-4xl leading-tight sm:text-5xl">{doc.title}</h1>
      </header>

      <div className="mt-6 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3.5 sm:px-5">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" aria-hidden />
        <p className="text-sm leading-relaxed text-amber-900">
          <span className="font-semibold">Research and educational use only.</span> {doc.summary}
        </p>
      </div>

      <nav
        aria-label="Contents"
        className="mt-8 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5"
      >
        <p className="eyebrow mb-2">Contents</p>
        <ol className="grid gap-1.5 text-sm sm:grid-cols-2">
          {doc.sections.map((section) => (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                className="text-slate-600 underline-offset-2 hover:text-indigo-700 hover:underline"
              >
                {section.heading}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="mt-8 space-y-8">
        {doc.sections.map((section) => (
          <section key={section.id} id={section.id} className="scroll-mt-24">
            <h2 className="text-xl font-semibold text-slate-900">{section.heading}</h2>
            {section.paragraphs?.map((paragraph) => (
              <p
                key={paragraph.slice(0, 40)}
                className="mt-2 text-sm leading-relaxed text-slate-600"
              >
                {paragraph}
              </p>
            ))}
            {section.bullets && (
              <ul className="mt-3 space-y-2">
                {section.bullets.map((bullet) => (
                  <li
                    key={bullet.slice(0, 40)}
                    className="flex gap-2.5 text-sm leading-relaxed text-slate-600"
                  >
                    <span
                      aria-hidden
                      className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400"
                    />
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      {footer && <div className="mt-10 border-t border-slate-200 pt-6">{footer}</div>}
    </article>
  );
}
