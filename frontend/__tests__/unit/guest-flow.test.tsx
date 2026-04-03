import { describe, it, expect, vi, beforeEach } from "vitest";
import { guestSession } from "../../src/helpers/guestSession";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import GuestScanWidget from "../../src/components/guestScanWidget";
import { receiptsApi } from "../../src/services/api";

// Mock API
vi.mock("../../src/services/api", () => ({
  receiptsApi: {
    getGuestUploadUrl: vi.fn(),
    pollGuestScanResult: vi.fn(),
  },
}));

describe("Guest Flow Utilities", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("guestSession creates and persists a unique session ID", () => {
    const id1 = guestSession.getOrCreate();
    expect(id1).toBeDefined();
    expect(typeof id1).toBe("string");

    const id2 = guestSession.getOrCreate();
    expect(id1).toBe(id2); // Should persist
  });

  it("guestSession.clear removes the ID", () => {
    guestSession.getOrCreate();
    guestSession.clear();
    expect(localStorage.getItem("cc_guest_session_id")).toBeNull();
  });
});

describe("GuestScanWidget Component", () => {
  const onConversion = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the idle state correctly", () => {
    render(<GuestScanWidget onConversion={onConversion} />);
    expect(screen.getByText(/Try AI Scanning/i)).toBeInTheDocument();
    expect(screen.getByText(/Drop a receipt here/i)).toBeInTheDocument();
  });

  it("shows uploading and scanning states then result teaser", async () => {
    const sessionId = "session-123";
    vi.mocked(receiptsApi.getGuestUploadUrl).mockResolvedValue({
      url: "http://mock-s3",
      fields: { key: "abc" },
      expenseId: "exp-1",
      scanId: "scan-1",
      key: `uploads/guest/${sessionId}/exp-1/scan-1/f.jpg`
    });

    vi.mocked(receiptsApi.pollGuestScanResult).mockImplementation(async () => {
      // Add a small delay to ensure the "scanning" state is rendered and caught by the test
      await new Promise(resolve => setTimeout(resolve, 50));
      return {
        status: "completed",
        extractedData: { merchant: "Starbucks", total: 5.50 }
      } as any;
    });

    global.fetch = vi.fn().mockResolvedValue({ ok: true });

    render(<GuestScanWidget onConversion={onConversion} />);
    
    const file = new File(["dummy content"], "receipt.png", { type: "image/png" });
    const input = screen.getByTestId("guest-file-input");
    
    fireEvent.change(input, { target: { files: [file] } });

    // 1. Should show uploading
    expect(screen.getByText(/Uploading.../i)).toBeInTheDocument();

    // 2. Should show scanning (after fetch resolves)
    expect(await screen.findByText(/AI is reading your receipt.../i)).toBeInTheDocument();

    // 3. Should show teaser result
    expect(await screen.findByText(/SCAN COMPLETE/i)).toBeInTheDocument();
    expect(screen.getByText(/Starbucks/i)).toBeInTheDocument();
    expect(screen.getByText(/\$5.50/i)).toBeInTheDocument();

    // 4. Verify conversion callback
    const saveBtn = screen.getByText(/Save to My Account/i);
    fireEvent.click(saveBtn);
    expect(onConversion).toHaveBeenCalled();
  });
});
