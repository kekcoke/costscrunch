import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SettingsPage } from "../../src/pages/settings";
import { profileApi, authApi } from "../../src/services/api";

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
});
