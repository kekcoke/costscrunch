import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import PasswordResetPage from "../../src/pages/passwordResetPage";
import { authApi } from "../../src/services/api";

const onNavigate = vi.fn();

vi.mock("../../src/services/api", () => ({
  authApi: {
    forgotPassword: vi.fn(),
    confirmPassword: vi.fn(),
  },
}));

describe("PasswordResetPage (orphaned top-level component)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("alert", vi.fn());
  });

  it("shows a validation error when email is blank", async () => {
    render(<PasswordResetPage onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText(/Send Reset Code/i));

    expect(await screen.findByText(/Email is required/i)).toBeInTheDocument();
    expect(authApi.forgotPassword).not.toHaveBeenCalled();
  });

  it("moves to the 'reset' step on forgotPassword success", async () => {
    vi.mocked(authApi.forgotPassword).mockResolvedValue({ message: "ok" });
    render(<PasswordResetPage onNavigate={onNavigate} />);

    fireEvent.change(screen.getByPlaceholderText("you@company.com"), { target: { value: "a@b.com" } });
    fireEvent.click(screen.getByText(/Send Reset Code/i));

    expect(await screen.findByText(/Enter your new password/i)).toBeInTheDocument();
  });

  it("shows an error message when forgotPassword fails", async () => {
    vi.mocked(authApi.forgotPassword).mockRejectedValue(new Error("User not found"));
    render(<PasswordResetPage onNavigate={onNavigate} />);

    fireEvent.change(screen.getByPlaceholderText("you@company.com"), { target: { value: "a@b.com" } });
    fireEvent.click(screen.getByText(/Send Reset Code/i));

    expect(await screen.findByText("User not found")).toBeInTheDocument();
  });

  async function advanceToStep2() {
    vi.mocked(authApi.forgotPassword).mockResolvedValue({ message: "ok" });
    render(<PasswordResetPage onNavigate={onNavigate} />);
    fireEvent.change(screen.getByPlaceholderText("you@company.com"), { target: { value: "a@b.com" } });
    fireEvent.click(screen.getByText(/Send Reset Code/i));
    await screen.findByText(/Enter your new password/i);
  }

  it("requires all fields on step 2", async () => {
    await advanceToStep2();
    fireEvent.click(screen.getByText(/Update Password/i));

    expect(await screen.findByText(/All fields are required/i)).toBeInTheDocument();
    expect(authApi.confirmPassword).not.toHaveBeenCalled();
  });

  it("requires passwords to match on step 2", async () => {
    await advanceToStep2();
    fireEvent.change(screen.getByPlaceholderText("000000"), { target: { value: "123456" } });
    const passwordInputs = document.querySelectorAll('input[type="password"]');
    fireEvent.change(passwordInputs[0], { target: { value: "password1" } });
    fireEvent.change(passwordInputs[1], { target: { value: "password2" } });
    fireEvent.click(screen.getByText(/Update Password/i));

    expect(await screen.findByText(/Passwords do not match/i)).toBeInTheDocument();
    expect(authApi.confirmPassword).not.toHaveBeenCalled();
  });

  it("confirmPassword success alerts and navigates to login", async () => {
    vi.mocked(authApi.confirmPassword).mockResolvedValue({ message: "ok" });
    await advanceToStep2();
    fireEvent.change(screen.getByPlaceholderText("000000"), { target: { value: "123456" } });
    const passwordInputs = document.querySelectorAll('input[type="password"]');
    fireEvent.change(passwordInputs[0], { target: { value: "password1" } });
    fireEvent.change(passwordInputs[1], { target: { value: "password1" } });
    fireEvent.click(screen.getByText(/Update Password/i));

    await waitFor(() => {
      expect(global.alert).toHaveBeenCalled();
      expect(onNavigate).toHaveBeenCalledWith("login");
    });
  });

  it("confirmPassword failure shows an error message", async () => {
    vi.mocked(authApi.confirmPassword).mockRejectedValue(new Error("Invalid code"));
    await advanceToStep2();
    fireEvent.change(screen.getByPlaceholderText("000000"), { target: { value: "123456" } });
    const passwordInputs = document.querySelectorAll('input[type="password"]');
    fireEvent.change(passwordInputs[0], { target: { value: "password1" } });
    fireEvent.change(passwordInputs[1], { target: { value: "password1" } });
    fireEvent.click(screen.getByText(/Update Password/i));

    expect(await screen.findByText("Invalid code")).toBeInTheDocument();
  });

  it("logo click navigates to landing", () => {
    render(<PasswordResetPage onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText("CostsCrunch"));
    expect(onNavigate).toHaveBeenCalledWith("landing");
  });

  it("'Back to sign in' link navigates to login", () => {
    render(<PasswordResetPage onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText(/Back to sign in/i));
    expect(onNavigate).toHaveBeenCalledWith("login");
  });
});
