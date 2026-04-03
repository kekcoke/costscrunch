import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import LoginPage from "../../src/pages/loginPage";
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
