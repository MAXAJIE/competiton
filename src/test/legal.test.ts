import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MIN_AGE, PRIVACY, PRIVACY_VERSION, RETENTION, TERMS, TERMS_VERSION } from "@/lib/legal";

const allText = (doc: typeof TERMS) =>
  [
    doc.summary,
    ...doc.sections.flatMap((s) => [...(s.paragraphs ?? []), ...(s.bullets ?? [])]),
  ].join(" ");

describe("legal documents", () => {
  it("say, in so many words, that this is only research and education", () => {
    for (const doc of [TERMS, PRIVACY]) {
      expect(allText(doc).toLowerCase()).toContain("research and educational");
    }
    expect(allText(TERMS).toLowerCase()).toContain("nothing in the app is financial");
    expect(allText(TERMS).toLowerCase()).toContain("do not make financial decisions");
  });

  it("require adults and state the age in both", () => {
    expect(MIN_AGE).toBeGreaterThanOrEqual(18);
    expect(allText(TERMS)).toContain(String(MIN_AGE));
    expect(allText(PRIVACY)).toContain(String(MIN_AGE));
  });

  it("disclose deletion, retention and the no-selling promise", () => {
    const privacy = allText(PRIVACY).toLowerCase();
    expect(privacy).toContain("deleting your account");
    expect(privacy).toContain("retention");
    expect(privacy).toContain("do not sell");
    expect(allText(TERMS).toLowerCase()).toContain("delete");
  });

  it("carry the same retention numbers the app enforces", () => {
    const privacy = allText(PRIVACY);
    expect(privacy).toContain(String(RETENTION.transactionsDays));
    expect(privacy).toContain(String(RETENTION.documentsDays));
    expect(privacy).toContain(String(RETENTION.maxTransactions));
    expect(privacy).toContain(String(RETENTION.maxDocuments));
  });

  it("explain the AI key, the AI providers and the security posture", () => {
    const privacy = allText(PRIVACY).toLowerCase();
    expect(privacy).toContain("openrouter");
    expect(privacy).toContain("supabase");
    expect(privacy).toContain("browser's local storage");
    expect(privacy).toContain("row level security");
    expect(privacy).toContain("rate limit");
  });

  it("have unique section anchors so the contents list cannot collide", () => {
    for (const doc of [TERMS, PRIVACY]) {
      const ids = doc.sections.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const section of doc.sections) {
        expect(section.heading.length).toBeGreaterThan(3);
        expect((section.paragraphs?.length ?? 0) + (section.bullets?.length ?? 0)).toBeGreaterThan(
          0,
        );
      }
    }
  });

  it("has a version on every document", () => {
    expect(TERMS.version).toBe(TERMS_VERSION);
    expect(PRIVACY.version).toBe(PRIVACY_VERSION);
    expect(TERMS.version).toMatch(/^\d+\.\d+$/);
  });
});

describe("version drift", () => {
  // The backend rejects a signup that accepted an older version, so the two
  // sides must move together. This test is the cheapest possible place to catch
  // someone bumping one and not the other.
  const config = readFileSync(path.resolve(process.cwd(), "backend/app/config.py"), "utf8");

  const backendVersion = (name: string) => {
    const match = new RegExp(`${name}\\s*=\\s*env\\("${name}",\\s*"([^"]+)"\\)`).exec(config);
    return match?.[1];
  };

  it("matches the backend's pinned versions", () => {
    expect(backendVersion("TERMS_VERSION")).toBe(TERMS_VERSION);
    expect(backendVersion("PRIVACY_VERSION")).toBe(PRIVACY_VERSION);
  });

  it("matches the backend's retention defaults", () => {
    const expected: Record<string, number> = {
      RETENTION_DAYS_TRANSACTIONS: RETENTION.transactionsDays,
      RETENTION_DAYS_DOCUMENTS: RETENTION.documentsDays,
      RETENTION_MAX_TRANSACTIONS: RETENTION.maxTransactions,
      RETENTION_MAX_DOCUMENTS: RETENTION.maxDocuments,
    };
    for (const [name, value] of Object.entries(expected)) {
      const match = new RegExp(`${name}\\s*=\\s*int\\(env\\("${name}",\\s*"(\\d+)"\\)`).exec(
        config,
      );
      expect(match?.[1], `${name} should be declared in backend/app/config.py`).toBe(String(value));
    }
  });
});
