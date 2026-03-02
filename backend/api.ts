// ─── Costscrunch — Frontend API Service ────────────────────────────────────────
// Wraps all backend calls with auth, error handling, retry logic

import { fetchAuthSession } from "aws-amplify/auth";
import type {
  Expense, Group, ScanResult, CreateExpenseRequest,
  GetExpensesQuery, ExpenseSummary, InitiateUploadResponse,
} from "./shared/types";

const API_BASE = import.meta.env.VITE_API_URL || "https://api.costscrunch.io";

// ─── Base fetch with auth ──────────────────────────────────────────────────────
async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const { tokens } = await fetchAuthSession();
  const token = tokens?.accessToken?.toString();

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new ApiError(error.error || "Request failed", response.status);
  }

  return response.json();
}

export class ApiError extends Error {
  constructor(message: string, public statusCode: number) {
    super(message);
    this.name = "ApiError";
  }
}

// ─── Expenses ─────────────────────────────────────────────────────────────────
export const expensesApi = {
  list: (params?: GetExpensesQuery) => {
    const qs = params ? "?" + new URLSearchParams(params as any).toString() : "";
    return apiFetch<{ items: Expense[]; nextToken: string | null; count: number }>(`/expenses${qs}`);
  },

  get: (id: string) => apiFetch<Expense>(`/expenses/${id}`),

  create: (data: CreateExpenseRequest) =>
    apiFetch<Expense>("/expenses", { method: "POST", body: JSON.stringify(data) }),

  update: (id: string, data: Partial<CreateExpenseRequest & { status: string; approverNote: string }>) =>
    apiFetch<Expense>(`/expenses/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  delete: (id: string) => apiFetch<{ deleted: boolean }>(`/expenses/${id}`, { method: "DELETE" }),

  approve: (id: string, note?: string) =>
    apiFetch<Expense>(`/expenses/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "approved", approverNote: note }),
    }),

  reject: (id: string, note: string) =>
    apiFetch<Expense>(`/expenses/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "rejected", approverNote: note }),
    }),
};

// ─── Receipts / Scanning ──────────────────────────────────────────────────────
export const receiptsApi = {
  // 1. Get pre-signed S3 upload URL
  getUploadUrl: (file: File, expenseId?: string) =>
    apiFetch<InitiateUploadResponse>("/receipts/upload-url", {
      method: "POST",
      body: JSON.stringify({
        filename: file.name,
        mimeType: file.type,
        fileSizeBytes: file.size,
        expenseId,
      }),
    }),

  // 2. Upload directly to S3 with pre-signed URL (bypasses Lambda, cheaper + faster)
  uploadToS3: async (uploadUrl: string, file: File): Promise<void> => {
    const response = await fetch(uploadUrl, {
      method: "PUT",
      body: file,
      headers: { "Content-Type": file.type },
    });
    if (!response.ok) throw new Error("S3 upload failed");
  },

  // 3. Full scan flow: get URL → upload → poll for results
  scanReceipt: async (
    file: File,
    onProgress?: (stage: "uploading" | "scanning" | "complete") => void
  ): Promise<{ expenseId: string; scanId: string; result?: ScanResult }> => {
    onProgress?.("uploading");
    const { uploadUrl, s3Key, expenseId, scanId } = await receiptsApi.getUploadUrl(file);
    await receiptsApi.uploadToS3(uploadUrl, file);

    onProgress?.("scanning");
    // Poll for results (Textract is async)
    const result = await receiptsApi.pollScanResult(expenseId, scanId);
    onProgress?.("complete");

    return { expenseId, scanId, result };
  },

  // Poll scan result with exponential backoff
  pollScanResult: async (expenseId: string, scanId: string, maxAttempts = 10): Promise<ScanResult> => {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise(r => setTimeout(r, Math.min(1000 * 2 ** attempt, 8000)));
      const result = await apiFetch<ScanResult>(`/receipts/${expenseId}/scan`);
      if (result.status === "completed" || result.status === "failed") {
        return result;
      }
    }
    throw new Error("Scan timed out");
  },
};

// ─── Groups ───────────────────────────────────────────────────────────────────
export const groupsApi = {
  list: () => apiFetch<{ items: Group[] }>("/groups"),
  get: (id: string) => apiFetch<Group>(`/groups/${id}`),
  create: (data: Partial<Group>) => apiFetch<Group>("/groups", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: Partial<Group>) => apiFetch<Group>(`/groups/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  getBalances: (id: string) => apiFetch<{ balances: Record<string, number>; settlements: Array<{ from: string; to: string; amount: number }> }>(`/groups/${id}/balances`),
  addMember: (id: string, data: { email: string; name?: string; role?: string }) =>
    apiFetch<{ added: unknown }>(`/groups/${id}/members`, { method: "POST", body: JSON.stringify(data) }),
};

// ─── Analytics ────────────────────────────────────────────────────────────────
export const analyticsApi = {
  summary: (period?: "month" | "quarter" | "year") =>
    apiFetch<ExpenseSummary & { byMonth: Record<string, number> }>(`/analytics/summary${period ? `?period=${period}` : ""}`),
  trends: () => apiFetch<{ trend: Array<{ month: string; total: number; count: number }> }>("/analytics/trends"),
};

// ─── React Query hooks (example patterns) ─────────────────────────────────────
// In production, wrap the above with @tanstack/react-query:
//
// export const useExpenses = (params?: GetExpensesQuery) =>
//   useQuery({ queryKey: ["expenses", params], queryFn: () => expensesApi.list(params) });
//
// export const useCreateExpense = () =>
//   useMutation({ mutationFn: expensesApi.create, onSuccess: () => queryClient.invalidateQueries({ queryKey: ["expenses"] }) });
//
// export const useScanReceipt = () =>
//   useMutation({ mutationFn: (file: File) => receiptsApi.scanReceipt(file) });