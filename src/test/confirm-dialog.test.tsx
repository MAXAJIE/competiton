import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ConfirmDialog } from "@/components/ConfirmDialog";

const copy = {
  title: "Log out of your account?",
  description: "You'll go back to the login screen.",
  confirmLabel: "Yes, log me out",
  cancelLabel: "Stay signed in",
};

function renderDialog(overrides: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const onOpenChange = vi.fn();
  const onConfirm = vi.fn();
  const view = render(
    <ConfirmDialog
      open
      {...copy}
      onOpenChange={onOpenChange}
      onConfirm={onConfirm}
      {...overrides}
    />,
  );
  return { ...view, onOpenChange, onConfirm };
}

describe("ConfirmDialog", () => {
  it("asks the question instead of signing out on the first click", () => {
    const { onConfirm } = renderDialog();

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Log out of your account?")).toBeInTheDocument();
    expect(screen.getByText(/go back to the login screen/i)).toBeInTheDocument();
    // Merely rendering the confirmation must never sign anybody out.
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("signs out only when the confirmation is accepted", () => {
    const { onConfirm } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Yes, log me out" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("closes without signing out when cancelled", async () => {
    const { onConfirm, onOpenChange } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Stay signed in" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("locks both buttons while the sign-out is in flight", () => {
    renderDialog({ busy: true, busyLabel: "Signing out…" });

    expect(screen.getByRole("button", { name: "Signing out…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Stay signed in" })).toBeDisabled();
  });
});
