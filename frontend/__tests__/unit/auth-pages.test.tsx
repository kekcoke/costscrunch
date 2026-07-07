import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import LoginPage from "../../src/pages/loginPage";
import LandingPage from "../../src/pages/landingPage";
import MFAPage from "../../src/pages/mfaPage";
import RegisterPage from "../../src/pages/registerPage";
import { authApi } from "../../src/services/api";
import { guestSession } from "../../src/helpers/guestSession";

// Mock Navigate
const onNavigate = vi.fn();

// Mock API
vi.mock("../../src/services/api", () => ({
  authApi: {
    login: vi.fn(),
    claimData: vi.fn(),
    logout: vi.fn(),
    confirmMfa: vi.fn(),
    register: vi.fn(),
    confirm: vi.fn(),
    forgotPassword: vi.fn(),
    confirmPassword: vi.fn(),
  },
}));

// Mock Guest Session
vi.mock("../../src/helpers/guestSession", () => ({
  guestSession: {
    exists: vi.fn(),
    getOrCreate: vi.fn(),
    clear: vi.fn(),
  },
}));

describe("LoginPage Flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls login and claims data if guest session exists", async () => {
    vi.mocked(authApi.login).mockResolvedValue({} as any);
    vi.mocked(guestSession.exists).mockReturnValue(true);
    vi.mocked(guestSession.getOrCreate).mockReturnValue("guest-123");

    render(<LoginPage onNavigate={onNavigate} />);

    fireEvent.change(screen.getByPlaceholderText(/you@company.com/i), { target: { value: "test@test.com" } });
    fireEvent.change(screen.getByPlaceholderText(/••••••••/i), { target: { value: "password" } });
    
    fireEvent.click(screen.getByText(/Sign in →/i));

    await waitFor(() => {
      expect(authApi.login).toHaveBeenCalledWith("test@test.com", "password");
      expect(authApi.claimData).toHaveBeenCalledWith("guest-123");
      expect(guestSession.clear).toHaveBeenCalled();
      expect(onNavigate).toHaveBeenCalledWith("dashboard");
    });
  });

  it("calls login but skips claiming if no guest session exists", async () => {
    vi.mocked(authApi.login).mockResolvedValue({} as any);
    vi.mocked(guestSession.exists).mockReturnValue(false);

    render(<LoginPage onNavigate={onNavigate} />);

    fireEvent.change(screen.getByPlaceholderText(/you@company.com/i), { target: { value: "test@test.com" } });
    fireEvent.change(screen.getByPlaceholderText(/••••••••/i), { target: { value: "password" } });

    fireEvent.click(screen.getByText(/Sign in →/i));

    await waitFor(() => {
      expect(authApi.login).toHaveBeenCalled();
      expect(authApi.claimData).not.toHaveBeenCalled();
      expect(onNavigate).toHaveBeenCalledWith("dashboard");
    });
  });
});

describe("LandingPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("logo click navigates to landing", () => {
    render(<LandingPage onNavigate={onNavigate} />);
    fireEvent.click(screen.getAllByText("CostsCrunch")[0]);
    expect(onNavigate).toHaveBeenCalledWith("landing");
  });

  it("sign-in button navigates to login", () => {
    render(<LandingPage onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText("Sign in"));
    expect(onNavigate).toHaveBeenCalledWith("login");
  });

  it("all register CTAs navigate to register", () => {
    render(<LandingPage onNavigate={onNavigate} />);

    const getStartedButtons = screen.getAllByText("Get started free");
    fireEvent.click(getStartedButtons[0]);
    expect(onNavigate).toHaveBeenLastCalledWith("register");

    fireEvent.click(screen.getByLabelText("Get started free"));
    expect(onNavigate).toHaveBeenLastCalledWith("register");

    fireEvent.click(screen.getByText(/Sign up free/i));
    expect(onNavigate).toHaveBeenLastCalledWith("register");
  });

  it("every pricing-tier CTA navigates to register", () => {
    render(<LandingPage onNavigate={onNavigate} />);

    fireEvent.click(screen.getByText("Try Pro free"));
    expect(onNavigate).toHaveBeenLastCalledWith("register");

    fireEvent.click(screen.getByText("Contact sales"));
    expect(onNavigate).toHaveBeenLastCalledWith("register");

    // "Get started free" appears both in nav and in the Free tier — use getAllByText
    const freeButtons = screen.getAllByText("Get started free");
    fireEvent.click(freeButtons[freeButtons.length - 1]);
    expect(onNavigate).toHaveBeenLastCalledWith("register");
  });
});

describe("MFAPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Guard against a fake-timer test failing before it restores real timers,
    // which would otherwise hang every subsequent async test in this block.
    vi.useRealTimers();
  });

  it("countdown decrements as time passes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    render(<MFAPage onNavigate={onNavigate} email="a@b.com" session="sess-1" />);
    const initial = screen.getByText(/\d+s/).textContent;
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    const after = screen.getByText(/\d+s/).textContent;
    expect(after).not.toBe(initial);
  });

  it("strips non-digit characters from the code input", () => {
    render(<MFAPage onNavigate={onNavigate} email="a@b.com" session="sess-1" />);
    const input = screen.getByLabelText(/6-digit authenticator code/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "12a3b4" } });
    expect(input.value).toBe("1234");
  });

  it("Enter key triggers verify", async () => {
    vi.mocked(authApi.confirmMfa).mockResolvedValue({} as any);
    render(<MFAPage onNavigate={onNavigate} email="a@b.com" session="sess-1" />);
    const input = screen.getByLabelText(/6-digit authenticator code/i);
    fireEvent.change(input, { target: { value: "123456" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(authApi.confirmMfa).toHaveBeenCalledWith("a@b.com", "123456", "sess-1");
    });
  });

  it("shows a validation error when code is not 6 digits", () => {
    render(<MFAPage onNavigate={onNavigate} email="a@b.com" session="sess-1" />);
    const input = screen.getByLabelText(/6-digit authenticator code/i);
    fireEvent.change(input, { target: { value: "123" } });
    fireEvent.click(screen.getByLabelText("Verify code"));

    expect(screen.getByRole("alert")).toHaveTextContent(/6-digit code/i);
    expect(authApi.confirmMfa).not.toHaveBeenCalled();
  });

  it("shows session-expired error and navigates to login after a delay when email/session missing", async () => {
    vi.useFakeTimers();
    render(<MFAPage onNavigate={onNavigate} />);
    const input = screen.getByLabelText(/6-digit authenticator code/i);
    fireEvent.change(input, { target: { value: "123456" } });
    fireEvent.click(screen.getByLabelText("Verify code"));

    expect(screen.getByRole("alert")).toHaveTextContent(/session expired/i);
    expect(onNavigate).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(onNavigate).toHaveBeenCalledWith("login");
  });

  it("navigates to dashboard on successful verification", async () => {
    vi.mocked(authApi.confirmMfa).mockResolvedValue({} as any);
    render(<MFAPage onNavigate={onNavigate} email="a@b.com" session="sess-1" />);
    const input = screen.getByLabelText(/6-digit authenticator code/i);
    fireEvent.change(input, { target: { value: "123456" } });
    fireEvent.click(screen.getByLabelText("Verify code"));

    await waitFor(() => {
      expect(onNavigate).toHaveBeenCalledWith("dashboard");
    });
  });

  it("shows the error message from a failed confirmMfa call", async () => {
    vi.mocked(authApi.confirmMfa).mockRejectedValue(new Error("Invalid code"));
    render(<MFAPage onNavigate={onNavigate} email="a@b.com" session="sess-1" />);
    const input = screen.getByLabelText(/6-digit authenticator code/i);
    fireEvent.change(input, { target: { value: "123456" } });
    fireEvent.click(screen.getByLabelText("Verify code"));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Invalid code");
    });
  });
});

describe("RegisterPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not call register when required fields are blank", async () => {
    render(<RegisterPage onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText(/Create account/i));
    await waitFor(() => {
      expect(authApi.register).not.toHaveBeenCalled();
    });
  });

  it("does not call register when passwords do not match", async () => {
    render(<RegisterPage onNavigate={onNavigate} />);
    const inputs = screen.getAllByRole("textbox");
    // fullName, email are text inputs; password fields have no role=textbox
    fireEvent.change(inputs[0], { target: { value: "Jane Doe" } });
    fireEvent.change(inputs[1], { target: { value: "jane@test.com" } });

    const passwordInputs = document.querySelectorAll('input[type="password"]');
    fireEvent.change(passwordInputs[0], { target: { value: "password1" } });
    fireEvent.change(passwordInputs[1], { target: { value: "password2" } });

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByText(/Create account/i));

    await waitFor(() => {
      expect(authApi.register).not.toHaveBeenCalled();
    });
  });

  it("does not call register when terms are unchecked", async () => {
    render(<RegisterPage onNavigate={onNavigate} />);
    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[0], { target: { value: "Jane Doe" } });
    fireEvent.change(inputs[1], { target: { value: "jane@test.com" } });
    const passwordInputs = document.querySelectorAll('input[type="password"]');
    fireEvent.change(passwordInputs[0], { target: { value: "password1" } });
    fireEvent.change(passwordInputs[1], { target: { value: "password1" } });

    fireEvent.click(screen.getByText(/Create account/i));

    await waitFor(() => {
      expect(authApi.register).not.toHaveBeenCalled();
    });
  });

  it("register success moves to confirm step", async () => {
    vi.mocked(authApi.register).mockResolvedValue({ message: "ok", email: "jane@test.com", userSub: "sub-1" });
    render(<RegisterPage onNavigate={onNavigate} />);
    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[0], { target: { value: "Jane Doe" } });
    fireEvent.change(inputs[1], { target: { value: "jane@test.com" } });
    const passwordInputs = document.querySelectorAll('input[type="password"]');
    fireEvent.change(passwordInputs[0], { target: { value: "password1" } });
    fireEvent.change(passwordInputs[1], { target: { value: "password1" } });
    fireEvent.click(screen.getByRole("checkbox"));

    fireEvent.click(screen.getByText(/Create account/i));

    expect(await screen.findByText(/Enter the code sent to jane@test.com/i)).toBeInTheDocument();
  });

  it("register failure shows global error", async () => {
    vi.mocked(authApi.register).mockRejectedValue(new Error("Email already exists"));
    render(<RegisterPage onNavigate={onNavigate} />);
    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[0], { target: { value: "Jane Doe" } });
    fireEvent.change(inputs[1], { target: { value: "jane@test.com" } });
    const passwordInputs = document.querySelectorAll('input[type="password"]');
    fireEvent.change(passwordInputs[0], { target: { value: "password1" } });
    fireEvent.change(passwordInputs[1], { target: { value: "password1" } });
    fireEvent.click(screen.getByRole("checkbox"));

    fireEvent.click(screen.getByText(/Create account/i));

    expect(await screen.findByText("Email already exists")).toBeInTheDocument();
  });

  it("confirm success navigates to login", async () => {
    vi.mocked(authApi.register).mockResolvedValue({ message: "ok", email: "jane@test.com", userSub: "sub-1" });
    vi.mocked(authApi.confirm).mockResolvedValue({ message: "ok" });
    render(<RegisterPage onNavigate={onNavigate} />);
    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[0], { target: { value: "Jane Doe" } });
    fireEvent.change(inputs[1], { target: { value: "jane@test.com" } });
    const passwordInputs = document.querySelectorAll('input[type="password"]');
    fireEvent.change(passwordInputs[0], { target: { value: "password1" } });
    fireEvent.change(passwordInputs[1], { target: { value: "password1" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByText(/Create account/i));

    await screen.findByText(/Enter the code sent to/i);

    fireEvent.change(screen.getByPlaceholderText("000000"), { target: { value: "123456" } });
    fireEvent.click(screen.getByText(/Verify & Sign in/i));

    await waitFor(() => {
      expect(onNavigate).toHaveBeenCalledWith("login");
    });
  });

  it("confirm failure shows a confirm-step error", async () => {
    vi.mocked(authApi.register).mockResolvedValue({ message: "ok", email: "jane@test.com", userSub: "sub-1" });
    vi.mocked(authApi.confirm).mockRejectedValue(new Error("Invalid code"));
    render(<RegisterPage onNavigate={onNavigate} />);
    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[0], { target: { value: "Jane Doe" } });
    fireEvent.change(inputs[1], { target: { value: "jane@test.com" } });
    const passwordInputs = document.querySelectorAll('input[type="password"]');
    fireEvent.change(passwordInputs[0], { target: { value: "password1" } });
    fireEvent.change(passwordInputs[1], { target: { value: "password1" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByText(/Create account/i));

    await screen.findByText(/Enter the code sent to/i);

    fireEvent.change(screen.getByPlaceholderText("000000"), { target: { value: "123456" } });
    fireEvent.click(screen.getByText(/Verify & Sign in/i));

    await waitFor(() => {
      expect(authApi.confirm).toHaveBeenCalled();
    });
  });

  it("logo click navigates to landing", () => {
    render(<RegisterPage onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText("CostsCrunch"));
    expect(onNavigate).toHaveBeenCalledWith("landing");
  });

  it("'Sign in' link navigates to login", () => {
    render(<RegisterPage onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText("Sign in"));
    expect(onNavigate).toHaveBeenCalledWith("login");
  });
});
