import { beforeEach, describe, expect, it } from "vitest";
import {
  aiKeyHeader,
  clearAiSettings,
  describeAccess,
  getAiSettings,
  maskKey,
  setAiSettings,
} from "@/lib/ai";
import type { AiConfig } from "@/lib/api";

const serverOnly: AiConfig = {
  provider: "openrouter",
  server_key: true,
  byok_supported: true,
  models: { ocr: "vision-model", advisor: "advisor-model" },
};

// The choice lives in this browser and nowhere else: these tests pin that down,
// including the "no header" case that must fall through to the server's key.
describe("AI access settings", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("starts undefined so the setup step knows the choice is still open", () => {
    expect(getAiSettings()).toBeNull();
    expect(getAiSettings()).toBeNull();
  });

  it("sends no key header when the server's key is chosen", () => {
    setAiSettings({ mode: "server" });
    expect(aiKeyHeader()).toEqual({});
  });

  it("sends the caller's key when BYOK is chosen", () => {
    setAiSettings({ mode: "byok", key: "sk-or-v1-abcdef123456", savedAt: "2024-01-01T00:00:00Z" });
    expect(aiKeyHeader()).toEqual({ "X-OpenRouter-Key": "sk-or-v1-abcdef123456" });
  });

  it("ignores a BYOK entry with no key instead of sending an empty header", () => {
    localStorage.setItem("cashflow.ai", JSON.stringify({ mode: "byok" }));
    expect(getAiSettings()).toBeNull();
    expect(aiKeyHeader()).toEqual({});
  });

  it("ignores a stored mode it does not understand", () => {
    localStorage.setItem("cashflow.ai", JSON.stringify({ mode: "openai", key: "x" }));
    expect(getAiSettings()).toBeNull();
    expect(aiKeyHeader()).toEqual({});
  });

  it("survives unreadable storage rather than breaking the page", () => {
    localStorage.setItem("cashflow.ai", "{not json");
    expect(getAiSettings()).toBeNull();
  });

  it("can forget a key in one step", () => {
    setAiSettings({ mode: "byok", key: "sk-or-v1-abcdef123456" });
    clearAiSettings();
    expect(getAiSettings()).toBeNull();
    expect(aiKeyHeader()).toEqual({});
  });
});

describe("key display", () => {
  it("masks all but the ends so a screenshot does not leak the key", () => {
    expect(maskKey("sk-or-v1-0123456789abcdef")).toBe("sk-or-v1-…cdef");
    expect(maskKey("short")).toBe("••••");
  });
});

describe("access summary", () => {
  it("reports the server's key", () => {
    expect(describeAccess(serverOnly, { mode: "server" })).toContain("this server");
  });

  it("reports the user's own key", () => {
    expect(describeAccess(serverOnly, { mode: "byok", key: "sk-or-v1-x" })).toContain("your own");
  });

  it("says so when the server has no key and none was supplied", () => {
    expect(describeAccess({ ...serverOnly, server_key: false }, null)).toContain("no key");
  });

  it("admits when the backend could not be reached", () => {
    expect(describeAccess(null, null)).toContain("unknown");
  });
});
