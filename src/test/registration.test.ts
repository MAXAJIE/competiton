import { beforeEach, describe, expect, it, vi } from "vitest";
import { cached, clearApiCache, readError } from "@/lib/api";
import {
  confirmProblem,
  emailProblem,
  passwordProblem,
  registrationProblem,
} from "@/lib/registration";

describe("registration rules", () => {
  const valid = {
    email: "owner@example.com",
    password: "longenough1",
    confirm: "longenough1",
    ageConfirmed: true,
    termsAccepted: true,
  };

  it("accepts a complete form", () => {
    expect(registrationProblem(valid)).toBeNull();
  });

  it("refuses the underage affirmation being missing", () => {
    expect(registrationProblem({ ...valid, ageConfirmed: false })).toContain("18 or older");
  });

  it("refuses the terms not being accepted", () => {
    expect(registrationProblem({ ...valid, termsAccepted: false })).toContain("Terms");
  });

  it("explains a weak password before the legal boxes are mentioned", () => {
    const problem = registrationProblem({ ...valid, password: "short1", confirm: "short1" });
    expect(problem).toContain("8 characters");
    expect(problem).not.toContain("Terms");
  });

  it("explains the password composition rule", () => {
    expect(passwordProblem("onlyletters")).toContain("letter and one digit");
    expect(passwordProblem("12345678")).toContain("letter and one digit");
    expect(passwordProblem("")).toBe("");
    expect(passwordProblem("goodpass1")).toBe("");
  });

  it("catches a confirmation that does not match", () => {
    expect(confirmProblem("goodpass1", "goodpass2")).toBe("Passwords do not match.");
    expect(confirmProblem("goodpass1", "")).toBe("");
    expect(confirmProblem("goodpass1", "goodpass1")).toBe("");
  });

  it("catches a malformed email", () => {
    expect(emailProblem("owner@example")).toContain("email address");
    expect(emailProblem("owner.example.com")).toContain("email address");
    expect(emailProblem("owner@example.com")).toBe("");
    expect(emailProblem("")).toBe("");
  });

  it("asks for the empty fields it is missing", () => {
    expect(registrationProblem({ ...valid, email: "  " })).toContain("email");
    expect(registrationProblem({ ...valid, password: "", confirm: "" })).toContain("password");
  });
});

describe("error messages", () => {
  it("turns a pydantic 422 into the field and the reason", () => {
    const body = {
      detail: [
        { loc: ["body", "amount"], msg: "Input should be greater than 0" },
        { loc: ["body", "type"], msg: "Input should be 'income'…" },
      ],
    };
    expect(readError(body, 422)).toBe("amount: Input should be greater than 0");
  });

  it("strips pydantic's 'Value error, ' prefix", () => {
    const body = {
      detail: [{ loc: ["body", "email"], msg: "Value error, must be an email address" }],
    };
    expect(readError(body, 422)).toBe("email: must be an email address");
  });

  it("keeps a plain string detail as-is", () => {
    expect(readError({ detail: "Too many requests." }, 429)).toBe("Too many requests.");
  });

  it("falls back to something useful for an empty body", () => {
    expect(readError({}, 429)).toContain("Too many requests");
    expect(readError(null, 401)).toContain("sign in again");
    expect(readError({}, 500)).toBe("Request failed (500)");
  });
});

describe("cached reads", () => {
  beforeEach(() => {
    clearApiCache();
  });

  it("calls the loader once inside the window", async () => {
    const load = vi.fn().mockResolvedValue({ v: 1 });
    expect(await cached("k", 1000, load)).toEqual({ v: 1 });
    expect(await cached("k", 1000, load)).toEqual({ v: 1 });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("calls again once the window has passed", async () => {
    const load = vi.fn().mockResolvedValueOnce("first").mockResolvedValueOnce("second");
    expect(await cached("k", -1, load)).toBe("first");
    expect(await cached("k", -1, load)).toBe("second");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("does not remember a failure", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce("up");
    await expect(cached("k", 1000, load)).rejects.toThrow("down");
    expect(await cached("k", 1000, load)).toBe("up");
  });

  it("shares one in-flight request between callers", async () => {
    const load = vi.fn().mockResolvedValue("once");
    const [a, b] = await Promise.all([cached("k", 1000, load), cached("k", 1000, load)]);
    expect(a).toBe("once");
    expect(b).toBe("once");
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe("a backend older than the site", () => {
  it("translates a missing delete route into something actionable", async () => {
    vi.resetModules();
    vi.doMock("@/lib/supabase", () => ({
      AUTH_CONFIGURED: false,
      supabase: { auth: { signOut: async () => undefined } },
      sessionOrNull: async () => ({
        access_token: "token",
        user: { id: "u1", email: "a@b.c" },
      }),
    }));
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ detail: "Not Found" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { deleteMyData } = await import("@/lib/api");
    await expect(deleteMyData()).rejects.toThrow(/older build/i);

    vi.unstubAllGlobals();
    vi.doUnmock("@/lib/supabase");
    vi.resetModules();
  });
});
