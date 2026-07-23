import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SigningBlock } from "./SigningBlock";

describe("SigningBlock", () => {
  it("requires a name before the act can be signed", () => {
    const onSign = vi.fn();
    render(
      <SigningBlock actLabel="Wave it through" prompt="You are about to wave it through." onSign={onSign} />,
    );
    const confirm = screen.getByText(/Sign — wave it through/i);
    // Empty name → the confirm is disabled; clicking does nothing.
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(onSign).not.toHaveBeenCalled();
  });

  it("signs with the name and role — a signature has a name", () => {
    const onSign = vi.fn();
    render(
      <SigningBlock actLabel="Make these promises" prompt="Sign the promises." onSign={onSign} />,
    );
    fireEvent.change(screen.getByPlaceholderText("Your name"), { target: { value: "Gilad" } });
    fireEvent.change(screen.getByPlaceholderText(/Role/), { target: { value: "CEO" } });
    fireEvent.click(screen.getByText(/Sign — make these promises/i));
    expect(onSign).toHaveBeenCalledWith({ name: "Gilad", role: "CEO" });
  });

  it("shows the disabled hint when nothing is accepted", () => {
    render(
      <SigningBlock
        actLabel="Make these promises"
        prompt="Sign the promises."
        onSign={() => {}}
        disabled
        disabledHint="Accept at least one promise to continue."
      />,
    );
    expect(screen.getByText("Accept at least one promise to continue.")).toBeInTheDocument();
    expect(screen.getByText(/Sign — make these promises/i)).toBeDisabled();
  });
});
