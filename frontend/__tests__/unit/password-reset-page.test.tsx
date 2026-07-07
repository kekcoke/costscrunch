import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PasswordResetPage from "../../src/pages/passwordReset";
import { authApi } from "../../src/services/api";

const mockNavigate = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...(actual as any), useNavigate: () => mockNavigate };
});

vi.mock("../../src/services/api", () => ({
  authApi: {
    forgotPassword: vi.fn(),
    confirmPassword: vi.fn(),
  },
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <PasswordResetPage />
    </MemoryRouter>
  );
}

describe("PasswordResetPage (wired-up, react-router)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("alert", vi.fn());
  });

  it("shows a validation error when email is blank", async () => {
    renderPage();
    fireEvent.click(screen.getByText(/Send reset code/i));

    expect(await screen.findByText(/Email is required/i)).toBeInTheDocument();
    expect(authApi.forgotPassword).not.toHaveBeenCalled();
  });

  it("moves to the 'sent' step on forgotPassword success", async () => {
    vi.mocked(authApi.forgotPassword).mockResolvedValue({ message: "ok" });
    renderPage();

    fireEvent.change(screen.getByLabelText(/Email address/i), { target: { value: "a@b.com" } });
    fireEvent.click(screen.getByText(/Send reset code/i));

    expect(await screen.findByText(/Check your email/i)).toBeInTheDocument();
  });

  it("shows a global error when forgotPassword fails", async () => {
    vi.mocked(authApi.forgotPassword).mockRejectedValue(new Error("User not found"));
    renderPage();

    fireEvent.change(screen.getByLabelText(/Email address/i), { target: { value: "a@b.com" } });
    fireEvent.click(screen.getByText(/Send reset code/i));

    expect(await screen.findByRole("alert")).toHaveTextContent("User not found");
  });

  async function advanceToStep2() {
    vi.mocked(authApi.forgotPassword).mockResolvedValue({ message: "ok" });
    renderPage();
    fireEvent.change(screen.getByLabelText(/Email address/i), { target: { value: "a@b.com" } });
    fireEvent.click(screen.getByText(/Send reset code/i));
    await screen.findByText(/Check your email/i);
  }

  it("validates missing fields on step 2", async () => {
    await advanceToStep2();
    fireEvent.click(screen.getByText(/Set new password/i));

    await waitFor(() => {
      expect(authApi.confirmPassword).not.toHaveBeenCalled();
    });
  });

  it("validates that passwords must match on step 2", async () => {
    await advanceToStep2();
    fireEvent.change(screen.getByPlaceholderText("000000"), { target: { value: "123456" } });
    fireEvent.change(screen.getByPlaceholderText("Min 8 characters"), { target: { value: "password1" } });
    fireEvent.change(screen.getByPlaceholderText("Repeat password"), { target: { value: "password2" } });
    fireEvent.click(screen.getByText(/Set new password/i));

    await waitFor(() => {
      expect(authApi.confirmPassword).not.toHaveBeenCalled();
    });
  });

  it("confirmPassword success alerts and navigates to /login", async () => {
    vi.mocked(authApi.confirmPassword).mockResolvedValue({ message: "ok" });
    await advanceToStep2();
    fireEvent.change(screen.getByPlaceholderText("000000"), { target: { value: "123456" } });
    fireEvent.change(screen.getByPlaceholderText("Min 8 characters"), { target: { value: "password1" } });
    fireEvent.change(screen.getByPlaceholderText("Repeat password"), { target: { value: "password1" } });
    fireEvent.click(screen.getByText(/Set new password/i));

    await waitFor(() => {
      expect(global.alert).toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith("/login");
    });
  });

  it("confirmPassword failure shows a global error", async () => {
    vi.mocked(authApi.confirmPassword).mockRejectedValue(new Error("Invalid code"));
    await advanceToStep2();
    fireEvent.change(screen.getByPlaceholderText("000000"), { target: { value: "123456" } });
    fireEvent.change(screen.getByPlaceholderText("Min 8 characters"), { target: { value: "password1" } });
    fireEvent.change(screen.getByPlaceholderText("Repeat password"), { target: { value: "password1" } });
    fireEvent.click(screen.getByText(/Set new password/i));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid code");
  });

  it("shows a back-to-login link", () => {
    renderPage();
    const link = screen.getByText(/Back to login/i);
    expect(link).toBeInTheDocument();
    expect(link.closest("a")).toHaveAttribute("href", "/login");
  });
});
