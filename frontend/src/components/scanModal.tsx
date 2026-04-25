// ─── CostsCrunch — ScanModal Component ───────────────────────────────────────
import { useState, useRef } from "react";
import Modal from "./modal";
import { CATEGORIES } from "../models/constants";
import { SCAN_MOCK_RESULTS } from './../mocks/results'
import type { ScanModalProps } from "../models/interfaceProps";
import type { CategoryName } from "../models/types";
import { type ScanForm, type ScanStage, EMPTY_FORM, FIELD_DEFS } from "../models/scanForm";
import { createExpenseFromForm } from "./../helpers/expense/createExpenseFromForm";


export default function ScanModal({ onClose, onAdd, userId = "user1", userName = "You" }: ScanModalProps & { userId?: string; userName?: string }) {
  const [stage,       setStage]       = useState<ScanStage>("idle");
  const [dragging,    setDragging]    = useState(false);
  const [scannedData, setScannedData] = useState<(typeof SCAN_MOCK_RESULTS)[number] | null>(null);
  const [form,        setForm]        = useState<ScanForm>(EMPTY_FORM);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const simulateScan = (file: File) => {
    setSelectedFile(file);
    setStage("uploading");
    
    // Simulate upload delay
    setTimeout(() => setStage("scanning"), 900);
    
    // Simulate scan completion
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
    if (file) {
      // Validate file type and size
      if (!file.type.match(/image.*|application.pdf/)) {
        alert("Please upload an image or PDF file");
        return;
      }
      if (file.size > 10 * 1024 * 1024) { // 10MB limit
        alert("File size must be less than 10MB");
        return;
      }
      simulateScan(file);
    }
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file type and size
      if (!file.type.match(/image.*|application\/pdf/)) {
        alert("Please upload an image or PDF file");
        return;
      }
      if (file.size > 10 * 1024 * 1024) { // 10MB limit
        alert("File size must be less than 10MB");
        return;
      }
      simulateScan(file);
    }
  };

  const openFilePicker = () => fileRef.current?.click();

  const handleSubmit = () => {
    // Validate form before submission
    if (!form.merchant.trim()) {
      alert("Merchant is required");
      return;
    }
    if (!form.amount || parseFloat(form.amount) <= 0) {
      alert("Valid amount is required");
      return;
    }
    if (!form.date) {
      alert("Date is required");
      return;
    }

    // Create expense object using helper function
    const expenseData = createExpenseFromForm(form, stage, userId, userName);
    
    // Pass to parent component
    onAdd(expenseData);
    onClose();
  };

  const handleManualEntry = () => {
    setStage("manual");
    setForm(EMPTY_FORM);
  };

  const resetToIdle = () => {
    setStage("idle");
    setScannedData(null);
    setForm(EMPTY_FORM);
    setSelectedFile(null);
    if (fileRef.current) {
      fileRef.current.value = ''; // Clear file input
    }
  };

  const stageSubtitle: Record<ScanStage, string> = {
    idle:      "Upload image or PDF — AI extracts the data",
    uploading: "⬆️ Uploading securely to S3...",
    scanning:  "🤖 AWS Textract + AI analyzing receipt...",
    result:    `Confidence: ${scannedData?.confidence ?? "—"}% — verify and save`,
    manual:    "Enter expense details manually",
  };

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={stage === "result" ? "✅ Receipt Scanned" : stage === "manual" ? "✏️ Manual Entry" : "📷 Scan Receipt"}
      subtitle={stageSubtitle[stage]}
      headerActions={
        (stage === "result" || stage === "manual") && (
          <button
            onClick={resetToIdle}
            aria-label="New Scan"
            style={{
              background: "#1e3048", border: "none", color: "#64748b",
              width: "32px", height: "32px", borderRadius: "8px",
              cursor: "pointer", fontSize: "16px",
            }}
          >
            ↺
          </button>
        )
      }
    >
      {/* Drop Zone */}
      <div>
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
                onClick={handleManualEntry}
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
              <style>{`
                @keyframes spin {
                  0% { transform: rotate(0deg); }
                  100% { transform: rotate(360deg); }
                }
              `}</style>
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
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {/* Primary success banner */}
                  <div
                    style={{
                      background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)",
                      borderRadius: "10px", padding: "12px 16px", fontSize: "12px", color: "#34d399",
                      display: "flex", alignItems: "center", gap: "8px",
                    }}
                  >
                    <span aria-hidden>✓</span>
                    AI extracted {Object.values(form).filter(Boolean).length} fields — review before saving
                    {selectedFile && (
                      <span style={{ marginLeft: "auto", fontSize: "10px", color: "#64748b" }}>
                        {selectedFile.name}
                      </span>
                    )}
                  </div>

                  {/* Multi-page flag badge */}
                  {'multiPage' in (scannedData ?? {}) && (scannedData as Record<string, unknown>).multiPage && (
                    <div
                      style={{
                        background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.25)",
                        borderRadius: "8px", padding: "8px 12px", fontSize: "11px", color: "#4ade80",
                        display: "flex", alignItems: "center", gap: "8px",
                      }}
                    >
                      <span aria-hidden>📄</span>
                      <span>Multi-page document — all pages scanned</span>
                    </div>
                  )}
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
    </Modal>
  );
}