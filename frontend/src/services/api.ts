// ─── CostsCrunch — Frontend API Service ──────────────────────────────────────
// Wraps all backend calls with auth, error handling, and retry logic.
// Types sourced from src/models/types.ts — no backend import required.

import { fetchAuthSession } from "@aws-amplify/auth";
import { toQueryString } from "../helpers/queryString";
import type {
  Expense, Group, ScanResult, CreateExpenseRequest,
  GetExpensesQuery, InitiateUploadResponse
} from "../models/types.js"
import type { ExpenseSummaryStats } from "../models/types";

const API_BASE = import.meta.env.VITE_API_URL ?? "https://api.costscrunch.io";

// ─── Custom error class ───────────────────────────────────────────────────────

export class ApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
  }
}

// ─── Authenticated base fetch ─────────────────────────────────────────────────
async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  // In local dev (MOCK_AUTH=true), Amplify is not configured — skip auth gracefully.
  // The Lambda _local/ handlers inject fake Cognito claims via withMockAuth().
  let token: string | undefined;
  try {
    const { tokens } = await fetchAuthSession();
    token = tokens?.accessToken?.toString();
  } catch {
    // No Cognito session — local dev mode, proceed without token
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new ApiError(body.error ?? "Request failed", response.status);
  }

  return response.json() as Promise<T>;
}

// ─── Expenses ─────────────────────────────────────────────────────────────────
export const expensesApi = {
  list: (params?: GetExpensesQuery) =>
    apiFetch<{ items: Expense[]; nextToken: string | null; count: number }>(
      `/expenses${toQueryString(params)}`
    ),

  get: (id: string) => apiFetch<Expense>(`/expenses/${id}`),

  create: (data: CreateExpenseRequest) =>
    apiFetch<Expense>("/expenses", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (
    id: string,
    data: Partial<CreateExpenseRequest & { status: string; approverNote: string }>
  ) =>
    apiFetch<Expense>(`/expenses/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    apiFetch<{ deleted: boolean }>(`/expenses/${id}`, { method: "DELETE" }),

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
    const res = await fetch(uploadUrl, {
      method: "PUT",
      body: file,
      headers: { "Content-Type": file.type },
    });
    if (!res.ok) throw new Error("S3 upload failed");
  },

  // 3. Full scan flow: get URL → upload → poll for results
  scanReceipt: async (
    file: File,
    onProgress?: (stage: "uploading" | "scanning" | "complete") => void
  ): Promise<{ expenseId: string; scanId: string; result?: ScanResult }> => {
    onProgress?.("uploading");
    const { uploadUrl, expenseId, scanId } = await receiptsApi.getUploadUrl(file);
    await receiptsApi.uploadToS3(uploadUrl, file);

    onProgress?.("scanning");
    // Poll for results (Textract is async)
    const result = await receiptsApi.pollScanResult(expenseId, scanId);
    onProgress?.("complete");

    return { expenseId, scanId, result };
  },

  // Poll scan result with exponential backoff
  pollScanResult: async (
    expenseId: string,
    scanId: string,
    maxAttempts = 10
  ): Promise<ScanResult> => {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise<void>((r) =>
        setTimeout(r, Math.min(1000 * 2 ** attempt, 8000))
      );
      const result = await apiFetch<ScanResult>(
        `/receipts/${expenseId}/scan?scanId=${scanId}`
      );
      if (result.status === "completed" || result.status === "failed") {
        return result;
      }
    }
    throw new Error("Scan timed out after maximum polling attempts");
  },
};

// ─── Groups ───────────────────────────────────────────────────────────────────
export const groupsApi = {
  list: () => apiFetch<{ items: Group[] }>("/groups"),
  get:  (id: string) => apiFetch<Group>(`/groups/${id}`),

  create: (data: Partial<Group>) =>
    apiFetch<Group>("/groups", { method: "POST", body: JSON.stringify(data) }),

  update: (id: string, data: Partial<Group>) =>
    apiFetch<Group>(`/groups/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  getBalances: (id: string) =>
    apiFetch<{
      balances: Record<string, number>;
      settlements: Array<{ from: string; to: string; amount: number }>;
    }>(`/groups/${id}/balances`),

  addMember: (
    id: string,
    data: { email: string; name?: string; role?: string }
  ) =>
    apiFetch<{ added: unknown }>(`/groups/${id}/members`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  deleteMember: (
    groupId: string,
    userId: string
  ): Promise<{ deleted: unknown }> => 
    apiFetch<{ deleted: unknown }>(`/groups/${groupId}/members/${userId}`, {
      method: "DELETE",
    }),

  delete: (id: string) =>
    apiFetch<{ deleted: boolean }>(`/groups/${id}`, { method: "DELETE" }),
};

// ─── Analytics ────────────────────────────────────────────────────────────────

export const analyticsApi = {
  summary: (query?: import("../models/types").AnalyticsQuery) =>
    apiFetch<ExpenseSummaryStats & { byMonth: Record<string, number> }>(
      `/analytics/summary${toQueryString(query)}`
    ),

  trends: (query?: import("../models/types").AnalyticsQuery) =>
    apiFetch<import("../models/types").AnalyticsTrends>(
      `/analytics/trends${toQueryString(query)}`
    ),

  chartData: (query?: import("../models/types").AnalyticsQuery) =>
    apiFetch<import("../models/types").AnalyticsChartData>(
      `/analytics/chart-data${toQueryString(query)}`
    ),
};

// ─── React Query hook patterns (wire up when ready) ───────────────────────────
//
// import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
//
// export const useExpenses = (params?: GetExpensesQuery) =>
//   useQuery({ queryKey: ["expenses", params], queryFn: () => expensesApi.list(params) });
//
// export const useCreateExpense = () => {
//   const qc = useQueryClient();
//   return useMutation({
//     mutationFn: expensesApi.create,
//     onSuccess: () => qc.invalidateQueries({ queryKey: ["expenses"] }),
//   });
// };
//
// export const useScanReceipt = () =>
//   useMutation({ mutationFn: (file: File) => receiptsApi.scanReceipt(file) });