import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const setTx = vi.fn();
const setRisk = vi.fn();
const deleteMyData = vi.fn();
const deleteMyAccount = vi.fn();
const applyRetention = vi.fn();
const fetchApiCapabilities = vi.fn();

vi.mock("@/lib/store", () => ({
  useStore: () => ({ mode: "user", setTx, setRisk }),
}));

vi.mock("@/lib/api", () => ({
  fetchConsent: vi.fn().mockResolvedValue({
    consent: {
      terms_version: "1.0",
      privacy_version: "1.0",
      age_confirmed: true,
      accepted_at: "2026-01-01T10:00:00.000Z",
    },
    terms_version: "1.0",
    privacy_version: "1.0",
    min_age: 18,
  }),
  fetchLegalConfig: vi.fn().mockResolvedValue({
    terms_version: "1.0",
    privacy_version: "1.0",
    min_age: 18,
    retention: {
      transactions_days: 1095,
      documents_days: 180,
      max_transactions: 5000,
      max_documents: 500,
    },
    purpose: "research_and_education_only",
  }),
  fetchApiCapabilities: (...args: unknown[]) => fetchApiCapabilities(...args),
  deleteMyData: (...args: unknown[]) => deleteMyData(...args),
  deleteMyAccount: (...args: unknown[]) => deleteMyAccount(...args),
  applyRetention: (...args: unknown[]) => applyRetention(...args),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));

import { DataPrivacyPanel } from "@/components/DataPrivacyPanel";

describe("Data & privacy panel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchApiCapabilities.mockResolvedValue({
      version: "0.2.0",
      features: ["signup", "legal", "consent", "delete-data", "delete-account", "retention"],
    });
    deleteMyData.mockResolvedValue({ transactions: 3, documents: 1, risk_settings: 1, uploads: 1 });
    applyRetention.mockResolvedValue({
      transactions: 0,
      documents: 0,
      risk_settings: 0,
      uploads: 0,
    });
  });

  it("shows the acceptance that was recorded", async () => {
    render(<DataPrivacyPanel />);
    expect(await screen.findByText(/You affirmed you are 18\+/)).toBeInTheDocument();
  });

  it("quotes the backend's retention numbers, not hard-coded ones", async () => {
    render(<DataPrivacyPanel />);
    expect(await screen.findByText(/1095 days · up to 5000 rows/)).toBeInTheDocument();
    expect(await screen.findByText(/180 days · up to 500 documents/)).toBeInTheDocument();
  });

  it("keeps account deletion disabled until DELETE is typed", async () => {
    render(<DataPrivacyPanel />);
    const button = await screen.findByRole("button", { name: /delete account/i });
    expect(button).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Type DELETE/i), { target: { value: "delete me" } });
    expect(button).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Type DELETE/i), { target: { value: "delete" } });
    expect(button).toBeEnabled();
  });

  it("asks before deleting data, then calls the backend and clears the store", async () => {
    render(<DataPrivacyPanel />);

    fireEvent.click(await screen.findByRole("button", { name: /delete my data/i }));
    expect(deleteMyData).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole("button", { name: /yes, delete my data/i }));
    await waitFor(() => expect(deleteMyData).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(setTx).toHaveBeenCalledWith([]));
    expect(setRisk).toHaveBeenCalled();
  });

  it("warns when the backend predates the delete routes instead of failing silently", async () => {
    fetchApiCapabilities.mockResolvedValue({ version: "0.1.0", features: [] });
    render(<DataPrivacyPanel />);

    expect(await screen.findByText(/has no delete endpoints/i)).toBeInTheDocument();
    expect(screen.getByText(/v0\.1\.0/)).toBeInTheDocument();
  });

  it("stays quiet when the backend advertises account deletion", async () => {
    render(<DataPrivacyPanel />);
    await screen.findByText(/You affirmed you are 18\+/);
    expect(screen.queryByText(/has no delete endpoints/i)).not.toBeInTheDocument();
  });

  it("does not offer the guest a server-side delete", async () => {
    vi.resetModules();
    vi.doMock("@/lib/store", () => ({ useStore: () => ({ mode: "guest", setTx, setRisk }) }));
    const { DataPrivacyPanel: GuestPanel } = await import("@/components/DataPrivacyPanel");
    render(<GuestPanel />);
    expect(await screen.findByText(/guest session/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete my account/i })).not.toBeInTheDocument();
    vi.doUnmock("@/lib/store");
    vi.resetModules();
  });
});
