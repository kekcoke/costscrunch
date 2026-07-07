import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchAuthSession } from "@aws-amplify/auth";
import {
  ApiError,
  expensesApi,
  receiptsApi,
  groupsApi,
  analyticsApi,
  profileApi,
  authApi,
} from "../../src/services/api";

vi.mock("@aws-amplify/auth", () => ({
  fetchAuthSession: vi.fn(),
}));

function jsonResponse(body: unknown, opts: { ok?: boolean; status?: number; contentType?: string } = {}) {
  const { ok = true, status = 200, contentType = "application/json" } = opts;
  return {
    ok,
    status,
    statusText: "Error",
    headers: {
      get: (name: string) => (name === "content-type" ? contentType : null),
    },
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(typeof body === "string" ? body : JSON.stringify(body)),
    blob: vi.fn().mockResolvedValue(new Blob([JSON.stringify(body)])),
  };
}

describe("api.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
    localStorage.clear();
    vi.mocked(fetchAuthSession).mockResolvedValue({
      tokens: { accessToken: { toString: () => "mock-access-token" } },
    } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("apiFetch (via expensesApi.list)", () => {
    it("attaches Authorization header when session exists", async () => {
      vi.mocked(global.fetch).mockResolvedValue(jsonResponse({ items: [], nextToken: null, count: 0 }) as any);

      await expensesApi.list();

      const callArgs = vi.mocked(global.fetch).mock.calls[0];
      const headers = callArgs[1]?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer mock-access-token");
    });

    it("omits Authorization header when fetchAuthSession throws", async () => {
      vi.mocked(fetchAuthSession).mockRejectedValue(new Error("no session"));
      vi.mocked(global.fetch).mockResolvedValue(jsonResponse({ items: [], nextToken: null, count: 0 }) as any);

      await expensesApi.list();

      const callArgs = vi.mocked(global.fetch).mock.calls[0];
      const headers = callArgs[1]?.headers as Record<string, string>;
      expect(headers.Authorization).toBeUndefined();
    });

    it("throws ApiError with parsed body on non-ok response", async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        jsonResponse({ error: "Not found" }, { ok: false, status: 404 }) as any
      );

      await expect(expensesApi.get("exp-1")).rejects.toMatchObject({
        name: "ApiError",
        message: "Not found",
        statusCode: 404,
      });
    });

    it("throws ApiError with statusText fallback when body isn't JSON", async () => {
      const resp = jsonResponse({}, { ok: false, status: 500 });
      resp.json = vi.fn().mockRejectedValue(new Error("invalid json"));
      resp.statusText = "Internal Server Error";
      vi.mocked(global.fetch).mockResolvedValue(resp as any);

      await expect(expensesApi.get("exp-1")).rejects.toMatchObject({
        message: "Internal Server Error",
        statusCode: 500,
      });
    });

    it("returns text for csv content-type", async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        jsonResponse("a,b,c", { contentType: "text/csv" }) as any
      );
      const result = await expensesApi.get("exp-1");
      expect(result).toBe("a,b,c");
    });

    it("returns blob for pdf content-type", async () => {
      const resp = jsonResponse({}, { contentType: "application/pdf" });
      vi.mocked(global.fetch).mockResolvedValue(resp as any);
      const result = await expensesApi.get("exp-1");
      expect(result).toBeInstanceOf(Blob);
    });

    it("returns json for default content-type", async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        jsonResponse({ id: "exp-1" }, { contentType: "application/json" }) as any
      );
      const result = await expensesApi.get("exp-1");
      expect(result).toEqual({ id: "exp-1" });
    });
  });

  describe("expensesApi", () => {
    beforeEach(() => {
      vi.mocked(global.fetch).mockResolvedValue(jsonResponse({ ok: true }) as any);
    });

    it("list", async () => {
      await expensesApi.list({ status: "approved" } as any);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/expenses"),
        expect.any(Object)
      );
    });

    it("get", async () => {
      await expensesApi.get("exp-1");
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/expenses/exp-1"),
        expect.any(Object)
      );
    });

    it("create", async () => {
      await expensesApi.create({ amount: 10 } as any);
      const [, opts] = vi.mocked(global.fetch).mock.calls[0];
      expect(opts?.method).toBe("POST");
    });

    it("update", async () => {
      await expensesApi.update("exp-1", { amount: 20 });
      const [, opts] = vi.mocked(global.fetch).mock.calls[0];
      expect(opts?.method).toBe("PATCH");
    });

    it("delete", async () => {
      await expensesApi.delete("exp-1");
      const [, opts] = vi.mocked(global.fetch).mock.calls[0];
      expect(opts?.method).toBe("DELETE");
    });

    it("approve", async () => {
      await expensesApi.approve("exp-1", "looks good");
      const [, opts] = vi.mocked(global.fetch).mock.calls[0];
      expect(JSON.parse(opts?.body as string)).toEqual({ status: "approved", approverNote: "looks good" });
    });

    it("reject", async () => {
      await expensesApi.reject("exp-1", "denied");
      const [, opts] = vi.mocked(global.fetch).mock.calls[0];
      expect(JSON.parse(opts?.body as string)).toEqual({ status: "rejected", approverNote: "denied" });
    });

    describe("export", () => {
      beforeEach(() => {
        (global as any).URL.createObjectURL = vi.fn().mockReturnValue("blob:mock-url");
        (global as any).URL.revokeObjectURL = vi.fn();
      });

      it("triggers a browser download for small CSV datasets", async () => {
        vi.mocked(global.fetch).mockResolvedValue(
          jsonResponse({ data: "a,b,c", format: "csv" }) as any
        );

        const realAnchor = document.createElement("a");
        const clickSpy = vi.spyOn(realAnchor, "click").mockImplementation(() => {});
        const createElSpy = vi.spyOn(document, "createElement").mockReturnValue(realAnchor);

        const result = await expensesApi.export({ format: "csv" });

        expect(URL.createObjectURL).toHaveBeenCalled();
        expect(clickSpy).toHaveBeenCalled();
        expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
        expect(result).toEqual({ data: "a,b,c", format: "csv" });

        createElSpy.mockRestore();
      });

      it("returns downloadUrl directly for large datasets", async () => {
        vi.mocked(global.fetch).mockResolvedValue(
          jsonResponse({ downloadUrl: "https://s3/presigned", format: "csv", count: 5000 }) as any
        );

        const result = await expensesApi.export({ format: "csv" });
        expect(result.downloadUrl).toBe("https://s3/presigned");
      });

      it("throws ApiError on non-ok response", async () => {
        vi.mocked(global.fetch).mockResolvedValue(
          jsonResponse({ error: "Export failed" }, { ok: false, status: 500 }) as any
        );

        await expect(expensesApi.export({ format: "csv" })).rejects.toMatchObject({
          name: "ApiError",
          message: "Export failed",
        });
      });

      it("omits Authorization header on export when fetchAuthSession throws", async () => {
        vi.mocked(fetchAuthSession).mockRejectedValue(new Error("no session"));
        vi.mocked(global.fetch).mockResolvedValue(
          jsonResponse({ downloadUrl: "https://s3/presigned", format: "csv" }) as any
        );

        await expensesApi.export({ format: "csv" });
        const [, opts] = vi.mocked(global.fetch).mock.calls[0];
        const headers = opts?.headers as Record<string, string>;
        expect(headers.Authorization).toBeUndefined();
      });
    });
  });

  describe("receiptsApi", () => {
    it("getUploadUrl", async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        jsonResponse({ url: "https://s3/upload", expenseId: "exp-1", scanId: "scan-1" }) as any
      );
      const file = new File(["x"], "r.jpg", { type: "image/jpeg" });
      const result = await receiptsApi.getUploadUrl(file, "exp-1");
      expect(result.url).toBe("https://s3/upload");
    });

    it("getGuestUploadUrl", async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        jsonResponse({ url: "https://s3/upload", expenseId: "exp-1", scanId: "scan-1" }) as any
      );
      const file = new File(["x"], "r.jpg", { type: "image/jpeg" });
      const result = await receiptsApi.getGuestUploadUrl(file, "sess-1");
      expect(result.url).toBe("https://s3/upload");
    });

    it("uploadToS3 succeeds", async () => {
      vi.mocked(global.fetch).mockResolvedValue({ ok: true } as any);
      const file = new File(["x"], "r.jpg", { type: "image/jpeg" });
      await expect(receiptsApi.uploadToS3("https://s3/put", file)).resolves.toBeUndefined();
    });

    it("uploadToS3 throws on failure", async () => {
      vi.mocked(global.fetch).mockResolvedValue({ ok: false } as any);
      const file = new File(["x"], "r.jpg", { type: "image/jpeg" });
      await expect(receiptsApi.uploadToS3("https://s3/put", file)).rejects.toThrow("S3 upload failed");
    });

    it("scanReceipt orchestrates upload and polling with progress callbacks", async () => {
      const onProgress = vi.fn();
      const getUploadUrlSpy = vi
        .spyOn(receiptsApi, "getUploadUrl")
        .mockResolvedValue({ url: "https://s3/put", expenseId: "exp-1", scanId: "scan-1" } as any);
      const uploadSpy = vi.spyOn(receiptsApi, "uploadToS3").mockResolvedValue(undefined);
      const pollSpy = vi
        .spyOn(receiptsApi, "pollScanResult")
        .mockResolvedValue({ status: "completed", merchant: "Store" } as any);

      const file = new File(["x"], "r.jpg", { type: "image/jpeg" });
      const result = await receiptsApi.scanReceipt(file, onProgress);

      expect(onProgress).toHaveBeenNthCalledWith(1, "uploading");
      expect(onProgress).toHaveBeenNthCalledWith(2, "scanning");
      expect(onProgress).toHaveBeenNthCalledWith(3, "complete");
      expect(result.expenseId).toBe("exp-1");
      expect(result.result).toEqual({ status: "completed", merchant: "Store" });

      getUploadUrlSpy.mockRestore();
      uploadSpy.mockRestore();
      pollSpy.mockRestore();
    });

    describe("pollScanResult", () => {
      beforeEach(() => {
        vi.useFakeTimers();
      });
      afterEach(() => {
        vi.useRealTimers();
      });

      it("returns the completed item once status resolves", async () => {
        vi.mocked(global.fetch)
          .mockResolvedValueOnce(jsonResponse({ items: [{ status: "processing" }] }) as any)
          .mockResolvedValueOnce(jsonResponse({ items: [{ status: "completed", merchant: "Store" }] }) as any);

        const promise = receiptsApi.pollScanResult("exp-1", "scan-1", 5);
        await vi.advanceTimersByTimeAsync(20000);
        const result = await promise;
        expect(result.status).toBe("completed");
      });

      it("throws after maxAttempts is exceeded", async () => {
        vi.mocked(global.fetch).mockResolvedValue(jsonResponse({ items: [{ status: "processing" }] }) as any);

        const promise = receiptsApi.pollScanResult("exp-1", "scan-1", 3);
        const assertion = expect(promise).rejects.toThrow("Scan timed out after maximum polling attempts");
        await vi.advanceTimersByTimeAsync(30000);
        await assertion;
      });
    });

    describe("pollGuestScanResult", () => {
      beforeEach(() => {
        vi.useFakeTimers();
      });
      afterEach(() => {
        vi.useRealTimers();
      });

      it("returns the completed item once status resolves", async () => {
        vi.mocked(global.fetch)
          .mockResolvedValueOnce(jsonResponse({ items: [{ status: "processing" }] }) as any)
          .mockResolvedValueOnce(jsonResponse({ items: [{ status: "failed" }] }) as any);

        const promise = receiptsApi.pollGuestScanResult("sess-1", 5);
        await vi.advanceTimersByTimeAsync(20000);
        const result = await promise;
        expect(result.status).toBe("failed");
      });

      it("throws after maxAttempts is exceeded", async () => {
        vi.mocked(global.fetch).mockResolvedValue(jsonResponse({ items: [{ status: "processing" }] }) as any);

        const promise = receiptsApi.pollGuestScanResult("sess-1", 3);
        const assertion = expect(promise).rejects.toThrow("Scan timed out after maximum polling attempts");
        await vi.advanceTimersByTimeAsync(30000);
        await assertion;
      });
    });

    it("getDownloadUrl", async () => {
      vi.mocked(global.fetch).mockResolvedValue(jsonResponse({ downloadUrl: "https://s3/dl" }) as any);
      const result = await receiptsApi.getDownloadUrl("exp-1");
      expect(result.downloadUrl).toBe("https://s3/dl");
    });
  });

  describe("groupsApi", () => {
    beforeEach(() => {
      vi.mocked(global.fetch).mockResolvedValue(jsonResponse({ ok: true }) as any);
    });

    it("list", async () => {
      await groupsApi.list();
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("/groups"), expect.any(Object));
    });

    it("get", async () => {
      await groupsApi.get("g1");
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("/groups/g1"), expect.any(Object));
    });

    it("create", async () => {
      await groupsApi.create({ name: "Trip" });
      const [, opts] = vi.mocked(global.fetch).mock.calls[0];
      expect(opts?.method).toBe("POST");
    });

    it("update", async () => {
      await groupsApi.update("g1", { name: "Trip 2" });
      const [, opts] = vi.mocked(global.fetch).mock.calls[0];
      expect(opts?.method).toBe("PATCH");
    });

    it("getBalances", async () => {
      await groupsApi.getBalances("g1");
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("/groups/g1/balances"), expect.any(Object));
    });

    it("settle", async () => {
      await groupsApi.settle("g1");
      const [, opts] = vi.mocked(global.fetch).mock.calls[0];
      expect(opts?.method).toBe("POST");
    });

    it("addMember", async () => {
      await groupsApi.addMember("g1", { email: "a@b.com" });
      const [, opts] = vi.mocked(global.fetch).mock.calls[0];
      expect(opts?.method).toBe("POST");
    });

    it("deleteMember", async () => {
      await groupsApi.deleteMember("g1", "u1");
      const [, opts] = vi.mocked(global.fetch).mock.calls[0];
      expect(opts?.method).toBe("DELETE");
    });

    it("delete", async () => {
      await groupsApi.delete("g1");
      const [, opts] = vi.mocked(global.fetch).mock.calls[0];
      expect(opts?.method).toBe("DELETE");
    });

    it("join", async () => {
      await groupsApi.join("g1");
      const [, opts] = vi.mocked(global.fetch).mock.calls[0];
      expect(opts?.method).toBe("POST");
    });
  });

  describe("analyticsApi", () => {
    beforeEach(() => {
      vi.mocked(global.fetch).mockResolvedValue(jsonResponse({ ok: true }) as any);
    });

    it("summary", async () => {
      await analyticsApi.summary();
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("/analytics/summary"), expect.any(Object));
    });

    it("trends", async () => {
      await analyticsApi.trends();
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("/analytics/trends"), expect.any(Object));
    });

    it("chartData", async () => {
      await analyticsApi.chartData();
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("/analytics/chart-data"), expect.any(Object));
    });
  });

  describe("profileApi", () => {
    beforeEach(() => {
      vi.mocked(global.fetch).mockResolvedValue(jsonResponse({ ok: true }) as any);
    });

    it("get", async () => {
      await profileApi.get();
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("/profile"), expect.any(Object));
    });

    it("update", async () => {
      await profileApi.update({ name: "New" });
      const [, opts] = vi.mocked(global.fetch).mock.calls[0];
      expect(opts?.method).toBe("PATCH");
    });
  });

  describe("authApi", () => {
    beforeEach(() => {
      vi.mocked(global.fetch).mockResolvedValue(jsonResponse({ message: "ok" }) as any);
    });

    it("register", async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        jsonResponse({ message: "ok", email: "a@b.com", userSub: "sub-1" }) as any
      );
      const result = await authApi.register("a@b.com", "pw", "Name");
      expect(result.userSub).toBe("sub-1");
    });

    it("confirm", async () => {
      const result = await authApi.confirm("a@b.com", "123456");
      expect(result.message).toBe("ok");
    });

    it("forgotPassword", async () => {
      const result = await authApi.forgotPassword("a@b.com");
      expect(result.message).toBe("ok");
    });

    it("confirmPassword", async () => {
      const result = await authApi.confirmPassword("a@b.com", "123456", "newpw");
      expect(result.message).toBe("ok");
    });

    it("deleteAccount", async () => {
      const result = await authApi.deleteAccount();
      expect(result.message).toBe("ok");
    });

    it("claimData", async () => {
      const result = await authApi.claimData("sess-1");
      expect(result.message).toBe("ok");
    });

    it("login stores 3 tokens in localStorage", async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        jsonResponse({
          accessToken: "acc-1",
          idToken: "id-1",
          refreshToken: "ref-1",
          expiresIn: 3600,
        }) as any
      );

      await authApi.login("a@b.com", "pw");

      expect(localStorage.getItem("cc_access_token")).toBe("acc-1");
      expect(localStorage.getItem("cc_id_token")).toBe("id-1");
      expect(localStorage.getItem("cc_refresh_token")).toBe("ref-1");
    });

    it("confirmMfa stores 3 tokens", async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        jsonResponse({
          accessToken: "acc-2",
          idToken: "id-2",
          refreshToken: "ref-2",
          expiresIn: 3600,
        }) as any
      );

      await authApi.confirmMfa("a@b.com", "123456", "session-token");

      expect(localStorage.getItem("cc_access_token")).toBe("acc-2");
      expect(localStorage.getItem("cc_id_token")).toBe("id-2");
      expect(localStorage.getItem("cc_refresh_token")).toBe("ref-2");
    });

    it("logout ALWAYS clears localStorage even when the POST rejects", async () => {
      localStorage.setItem("cc_access_token", "acc");
      localStorage.setItem("cc_id_token", "id");
      localStorage.setItem("cc_refresh_token", "ref");

      vi.mocked(global.fetch).mockResolvedValue(
        jsonResponse({ error: "server error" }, { ok: false, status: 500 }) as any
      );

      await expect(authApi.logout()).rejects.toThrow();

      expect(localStorage.getItem("cc_access_token")).toBeNull();
      expect(localStorage.getItem("cc_id_token")).toBeNull();
      expect(localStorage.getItem("cc_refresh_token")).toBeNull();
    });
  });

  it("ApiError sets name, message, and statusCode", () => {
    const err = new ApiError("Something broke", 418);
    expect(err.name).toBe("ApiError");
    expect(err.message).toBe("Something broke");
    expect(err.statusCode).toBe(418);
  });
});
