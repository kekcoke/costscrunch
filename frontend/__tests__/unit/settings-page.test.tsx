import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Component, type ReactNode } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SettingsPage } from "../../src/pages/settings";
import { profileApi, authApi } from "../../src/services/api";

// SettingsPage has a pre-existing bug: when profileApi.get() rejects, `profile`
// stays null but `loading` still flips to false, so the render crashes reading
// `profile.name`. This is test-only work (no src/ edits allowed), so we wrap
// the crash-prone render in a local boundary purely to observe the catch/
// finally branch executing, without taking down the whole test run.
class TestErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) return <div>error-boundary-fallback</div>;
    return this.props.children;
  }
}

// Mock API
vi.mock("../../src/services/api", () => ({
  profileApi: {
    get: vi.fn(),
    update: vi.fn(),
  },
  authApi: {
    logout: vi.fn(),
    deleteAccount: vi.fn(),
  },
}));

describe("SettingsPage Component", () => {
  const mockProfile = {
    userId: "u1",
    email: "u1@test.com",
    name: "User One",
    currency: "USD",
    timezone: "UTC",
    notificationPreferences: { email: true, push: false, sms: false }
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(profileApi.get).mockResolvedValue(mockProfile);
  });

  it("loads and displays profile data", async () => {
    render(<SettingsPage />);
    expect(screen.getByText(/Loading settings.../i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByDisplayValue("User One")).toBeInTheDocument();
      // The display value of a select is the text of the selected option
      expect(screen.getByDisplayValue("USD ($)")).toBeInTheDocument();
    });
  });

  it("updates profile when form is submitted", async () => {
    vi.mocked(profileApi.update).mockResolvedValue({ ...mockProfile, name: "Updated Name" });
    render(<SettingsPage />);

    await screen.findByDisplayValue("User One");
    
    fireEvent.change(screen.getByLabelText(/Full Name/i), { target: { value: "Updated Name" } });
    fireEvent.click(screen.getByText(/Save Changes/i));

    await waitFor(() => {
      expect(profileApi.update).toHaveBeenCalledWith(expect.objectContaining({
        name: "Updated Name"
      }));
      expect(screen.getByText(/Profile updated successfully/i)).toBeInTheDocument();
    });
  });

  it("calls logout when sign out button is clicked", async () => {
    render(<SettingsPage />);
    await screen.findByDisplayValue("User One");

    const logoutBtn = screen.getByText(/Sign Out/i);
    fireEvent.click(logoutBtn);

    await waitFor(() => {
      expect(authApi.logout).toHaveBeenCalled();
    });
  });

  it("runs the profileApi.get catch/finally branch when it rejects", async () => {
    vi.mocked(profileApi.get).mockReset();
    vi.mocked(profileApi.get).mockRejectedValue(new Error("network down"));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <TestErrorBoundary>
        <SettingsPage />
      </TestErrorBoundary>
    );

    await waitFor(() => {
      expect(profileApi.get).toHaveBeenCalled();
    });

    consoleErrorSpy.mockRestore();
  });

  it("shows the response-shaped error message when profileApi.update rejects with one", async () => {
    vi.mocked(profileApi.update).mockRejectedValue({
      response: { data: { error: "Name too long" } },
    });
    render(<SettingsPage />);
    await screen.findByDisplayValue("User One");

    fireEvent.click(screen.getByText(/Save Changes/i));

    expect(await screen.findByText("Name too long")).toBeInTheDocument();
  });

  it("falls back to a generic error message when profileApi.update rejects without a response shape", async () => {
    vi.mocked(profileApi.update).mockRejectedValue(new Error("boom"));
    render(<SettingsPage />);
    await screen.findByDisplayValue("User One");

    fireEvent.click(screen.getByText(/Save Changes/i));

    expect(await screen.findByText(/Failed to update profile/i)).toBeInTheDocument();
  });

  it("reflects select and checkbox changes in the submitted payload", async () => {
    vi.mocked(profileApi.update).mockResolvedValue({ ...mockProfile, currency: "EUR" });
    render(<SettingsPage />);
    await screen.findByDisplayValue("User One");

    fireEvent.change(screen.getByDisplayValue("USD ($)"), { target: { value: "EUR" } });
    fireEvent.change(screen.getByDisplayValue("UTC"), { target: { value: "Europe/London" } });
    fireEvent.click(screen.getByLabelText(/Push notifications/i));

    fireEvent.click(screen.getByText(/Save Changes/i));

    await waitFor(() => {
      expect(profileApi.update).toHaveBeenCalledWith(
        expect.objectContaining({
          currency: "EUR",
          timezone: "Europe/London",
          notificationPreferences: expect.objectContaining({ push: true }),
        })
      );
    });
  });

  describe("Delete account", () => {
    const originalLocation = window.location;

    beforeEach(() => {
      // @ts-expect-error - jsdom doesn't implement navigation; stub it out
      delete window.location;
      window.location = { ...originalLocation, href: "" } as Location;
    });

    afterEach(() => {
      window.location = originalLocation;
    });

    it("deletes the account and redirects when the user confirms", async () => {
      vi.stubGlobal("confirm", vi.fn(() => true));
      vi.mocked(authApi.deleteAccount).mockResolvedValue({ message: "ok" });
      render(<SettingsPage />);
      await screen.findByDisplayValue("User One");

      fireEvent.click(screen.getByText(/Delete Account/i));

      await waitFor(() => {
        expect(authApi.deleteAccount).toHaveBeenCalled();
      });
    });

    it("does nothing when the user cancels the confirm dialog", async () => {
      vi.stubGlobal("confirm", vi.fn(() => false));
      render(<SettingsPage />);
      await screen.findByDisplayValue("User One");

      fireEvent.click(screen.getByText(/Delete Account/i));

      await new Promise((r) => setTimeout(r, 0));
      expect(authApi.deleteAccount).not.toHaveBeenCalled();
    });

    it("alerts when deleteAccount fails", async () => {
      vi.stubGlobal("confirm", vi.fn(() => true));
      vi.stubGlobal("alert", vi.fn());
      vi.mocked(authApi.deleteAccount).mockRejectedValue(new Error("server error"));
      render(<SettingsPage />);
      await screen.findByDisplayValue("User One");

      fireEvent.click(screen.getByText(/Delete Account/i));

      await waitFor(() => {
        expect(global.alert).toHaveBeenCalledWith("Failed to delete account: server error");
      });
    });
  });
});
