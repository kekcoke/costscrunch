// ─── CostsCrunch — ScanModal Component ───────────────────────────────────────
import { useState, useRef } from "react";
import { CATEGORIES, SCAN_MOCK_RESULTS } from "../models/constants";
import type { ScanModalProps } from "../models/interfaceProps";
import type { CategoryName } from "../models/types";

type ScanStage = "idle" | "uploading" | "scanning" | "result" | "manual";

interface ScanForm {
  merchant: string;
  amount:   string;
  category: CategoryName;
  date:     string;
  notes:    string;
}

const FIELD_DEFS: Array<{
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

const EMPTY_FORM: ScanForm = {
  merchant: "",
  amount:   "",
  category: "Other",
  date:     new Date().toISOString().slice(0, 10),
  notes:    "",
};

export default function ScanModal({ onClose, onAdd }: ScanModalProps) {
  const [stage,       setStage]       = useState<ScanStage>("idle");
  const [dragging,    setDragging]    = useState(false);
  const [scannedData, setScannedData] = useState<(typeof SCAN_MOCK_RESULTS)[number] | null>(null);
  const [form,        setForm]        = useState<ScanForm>(EMPTY_FORM);
  const fileRef = useRef<HTMLInputElement>(null);

  const simulateScan = (_file: File) => {
    void _file; // temporary fix
    setStage("uploading");
    setTimeout(() => setStage("scanning"), 900);
    setTimeout(() => {
      const result = SCAN_MOCK_RESULTS[Math.floor(Math.random() * SCAN_MOCK_RESULTS.length)];
      setScannedData(result);
      setForm({
        merchant: result.merchant,
        amount:   result.amount,
        category: result.category as CategoryName,
        date:     result.date,
        notes:    result.notes,
      });
      setStage("result");
    }, 2800);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) simulateScan(file);
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) simulateScan(file);
  };

  const openFilePicker = () => fileRef.current?.click();

  const handleSubmit = () => {
    onAdd({
      merchant:  form.merchant,
      amount:    parseFloat(form.amount) || 0,
      category:  form.category,
      date:      form.date,
      notes:     form.notes,
      status:    "pending",
      receipt:   stage === "result",
      addedBy:   "You",
      group:     null,
      currency:  "USD",
    });
    onClose();
  };

  const stageSubtitle: Record<ScanStage, string> = {
    idle:      "Upload image or PDF — AI extracts the data",
    uploading: "Uploading to S3...",
    scanning:  "Textract + Claude analyzing receipt...",
    result:    `Confidence: ${scannedData?.confidence ?? "—"}% — verify and save`,
    manual:    "Enter expense details manually",
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.75)",
        backdropFilter: "blur(8px)",
        zIndex: 1000,
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "20px",
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          background: "#0f1724",
          border: "1px solid #1e3048",
          borderRadius: "20px",
          width: "100%", maxWidth: "520px",
          overflow: "hidden",
          boxShadow: "0 40px 80px rgba(0,0,0,0.6)",
        }}
      >
        {/* Header */}
        <div style={{ padding: "24px 28px 0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: "20px", fontWeight: 700, color: "var(--color-text)" }}>
              {stage === "result" ? "✅ Receipt Scanned" : "📷 Scan Receipt"}
            </div>
            <div style={{ fontSize: "12px", color: "#64748b", marginTop: "3px" }}>
              {stageSubtitle[stage]}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "#1e3048", border: "none", color: "#64748b",
              width: "32px", height: "32px", borderRadius: "8px",
              cursor: "pointer", fontSize: "16px",
            }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: "24px 28px 28px" }}>
          {/* Drop Zone */}
          {stage === "idle" && (
            <>
              <div
                role="button"
                tabIndex={0}
                onDrop={handleDrop}
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onClick={openFilePicker}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && openFilePicker()}
                style={{
                  border: `2px dashed ${dragging ? "#38bdf8" : "#1e3048"}`,
                  borderRadius: "14px", padding: "48px 24px",
                  textAlign: "center", cursor: "pointer",
                  transition: "all 0.2s",
                  background: dragging ? "rgba(56,189,248,0.05)" : "rgba(255,255,255,0.01)",
                  marginBottom: "16px",
                }}
              >
                <div style={{ fontSize: "40px", marginBottom: "12px" }}>📄</div>
                <div style={{ color: "#94a3b8", fontSize: "14px", fontWeight: 500 }}>
                  Drop receipt image or PDF here
                </div>
                <div style={{ color: "#475569", fontSize: "12px", marginTop: "6px" }}>
                  or click to browse — JPG, PNG, PDF up to 10 MB
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*,.pdf"
                  onChange={handleFile}
                  style={{ display: "none" }}
                />
              </div>
              <button
                onClick={() => setStage("manual")}
                style={{
                  width: "100%", background: "transparent",
                  border: "1px solid #1e3048", color: "#64748b",
                  padding: "10px", borderRadius: "10px",
                  cursor: "pointer", fontSize: "13px",
                }}
              >
                Enter manually instead
              </button>
            </>
          )}

          {/* Scanning Spinner */}
          {(stage === "uploading" || stage === "scanning") && (
            <div style={{ textAlign: "center", padding: "48px 0" }}>
              <div
                style={{
                  width: "64px", height: "64px", borderRadius: "50%",
                  border: "3px solid #1e3048", borderTopColor: "#38bdf8",
                  animation: "spin 0.8s linear infinite",
                  margin: "0 auto 20px",
                }}
              />
              <div style={{ color: "#94a3b8", fontSize: "14px" }}>
                {stage === "uploading" ? "⬆️ Uploading securely to S3..." : "🤖 AWS Textract + AI parsing..."}
              </div>
              {stage === "scanning" && (
                <div style={{ marginTop: "16px", display: "flex", justifyContent: "center", gap: "8px", flexWrap: "wrap" }}>
                  {["OCR extraction", "Merchant detection", "Amount parsing", "Date recognition", "Category AI"].map((s) => (
                    <span
                      key={s}
                      style={{
                        background: "rgba(56,189,248,0.1)", border: "1px solid rgba(56,189,248,0.2)",
                        color: "#38bdf8", fontSize: "11px", padding: "3px 8px", borderRadius: "4px",
                      }}
                    >
                      {s}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Result / Manual Form */}
          {(stage === "result" || stage === "manual") && (
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              {stage === "result" && (
                <div
                  style={{
                    background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)",
                    borderRadius: "10px", padding: "12px 16px", fontSize: "12px", color: "#34d399",
                    display: "flex", alignItems: "center", gap: "8px",
                  }}
                >
                  <span aria-hidden>✓</span>
                  AI extracted {Object.values(form).filter(Boolean).length} fields — review before saving
                </div>
              )}

              {FIELD_DEFS.map((f) => (
                <div key={f.key}>
                  <label
                    htmlFor={`scan-${f.key}`}
                    style={{ display: "block", fontSize: "11px", color: "#64748b", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.5px" }}
                  >
                    {f.label}
                  </label>
                  <input
                    id={`scan-${f.key}`}
                    type={f.type}
                    value={form[f.key]}
                    onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                    style={{
                      width: "100%", background: "#0a1220",
                      border: "1px solid #1e3048", borderRadius: "8px",
                      padding: "10px 14px", color: "var(--color-text)",
                      fontSize: "14px", outline: "none", boxSizing: "border-box",
                    }}
                  />
                </div>
              ))}

              <div>
                <label
                  htmlFor="scan-category"
                  style={{ display: "block", fontSize: "11px", color: "#64748b", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.5px" }}
                >
                  Category
                </label>
                <select
                  id="scan-category"
                  value={form.category}
                  onChange={(e) => setForm((p) => ({ ...p, category: e.target.value as CategoryName }))}
                  style={{
                    width: "100%", background: "#0a1220",
                    border: "1px solid #1e3048", borderRadius: "8px",
                    padding: "10px 14px", color: "var(--color-text)",
                    fontSize: "14px", outline: "none",
                  }}
                >
                  {Object.keys(CATEGORIES).map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              <button
                onClick={handleSubmit}
                style={{
                  width: "100%",
                  background: "linear-gradient(135deg, #0ea5e9, #6366f1)",
                  border: "none", borderRadius: "10px", padding: "14px",
                  color: "white", fontWeight: 700, fontSize: "15px",
                  cursor: "pointer", marginTop: "4px",
                }}
              >
                Save Expense →
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}