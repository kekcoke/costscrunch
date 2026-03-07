import type { CategoryName } from "./types";

export type ScanStage = "idle" | "uploading" | "scanning" | "result" | "manual";

export interface ScanForm {
  merchant: string;
  amount:   string;
  category: CategoryName;
  date:     string;
  notes:    string;
}

export const FIELD_DEFS: Array<{
  key: keyof Omit<ScanForm, "category">;
  label: string;
  type: string;
  placeholder?: string;
}> = [
  { key: "merchant", label: "Merchant",     type: "text",   placeholder: "e.g. Starbucks" },
  { key: "amount",   label: "Amount (USD)", type: "number", placeholder: "0.00" },
  { key: "date",     label: "Date",         type: "date" },
  { key: "notes",    label: "Notes",        type: "text",   placeholder: "Optional description" },
];

export const EMPTY_FORM: ScanForm = {
  merchant: "",
  amount:   "",
  category: "Other",
  date:     new Date().toISOString().slice(0, 10),
  notes:    "",
};