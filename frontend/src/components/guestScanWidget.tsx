import { useState, useRef } from "react";
import { receiptsApi } from "../services/api";
import { guestSession } from "../helpers/guestSession";
import type { ScanResult } from "../models/types";

interface Props {
  onConversion: () => void;
}

type WidgetStage = "idle" | "uploading" | "scanning" | "teaser";

export default function GuestScanWidget({ onConversion }: Props) {
  const [stage, setStage] = useState<WidgetStage>("idle");
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    if (!file.type.match(/image.*|application\/pdf/)) {
      setError("Please use JPG, PNG or PDF");
      return;
    }

    setError("");
    setStage("uploading");
    const sessionId = guestSession.getOrCreate();

    try {
      // 1. Get Guest Upload URL
      const { url, fields, expenseId } = await receiptsApi.getGuestUploadUrl(file, sessionId);
      
      // 2. Upload to S3
      const formData = new FormData();
      Object.entries(fields).forEach(([key, value]) => formData.append(key, value as string));
      formData.append("file", file);

      const res = await fetch(url, { method: "POST", body: formData });
      if (!res.ok) throw new Error("Upload failed");

      setStage("scanning");

      // 3. Poll for result (Guest version)
      const scanResult = await receiptsApi.pollGuestScanResult(sessionId);
      setResult(scanResult);
      setStage("teaser");
    } catch (e: any) {
      console.error(e);
      setError("Scanning failed. Try again?");
      setStage("idle");
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files?.[0]) handleFile(e.dataTransfer.files[0]);
  };

  return (
    <div style={{
      background: "var(--color-surface)",
      border: "1px solid var(--color-border)",
      borderRadius: "24px",
      padding: "32px",
      width: "100%",
      maxWidth: "480px",
      margin: "0 auto",
      boxShadow: "0 20px 50px rgba(0,0,0,0.3)",
      position: "relative",
      overflow: "hidden"
    }}>
      {stage === "idle" && (
        <div 
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => fileRef.current?.click()}
          style={{
            border: `2px dashed ${dragging ? "#38bdf8" : "var(--color-border)"}`,
            borderRadius: "16px",
            padding: "40px 20px",
            textAlign: "center",
            cursor: "pointer",
            transition: "all 0.2s",
            background: dragging ? "rgba(56,189,248,0.05)" : "transparent"
          }}
        >
          <div style={{ fontSize: "48px", marginBottom: "16px" }}>📸</div>
          <h3 style={{ fontSize: "18px", fontWeight: 700, marginBottom: "8px" }}>Try AI Scanning</h3>
          <p style={{ fontSize: "14px", color: "var(--color-text-dim)" }}>
            Drop a receipt here to see the magic. <br/> No account required.
          </p>
          {error && <p style={{ color: "#ef4444", fontSize: "12px", marginTop: "12px" }}>{error}</p>}
          <input 
            type="file" 
            ref={fileRef} 
            data-testid="guest-file-input"
            style={{ display: "none" }} 
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
        </div>
      )}

      {(stage === "uploading" || stage === "scanning") && (
        <div style={{ textAlign: "center", padding: "40px 0" }}>
          <div className="spinner" style={{
            width: "48px", height: "48px", border: "3px solid #1e3048",
            borderTopColor: "#38bdf8", borderRadius: "50%",
            animation: "spin 1s linear infinite", margin: "0 auto 20px"
          }}/>
          <p style={{ fontWeight: 600 }}>{stage === "uploading" ? "Uploading..." : "AI is reading your receipt..."}</p>
          <p style={{ fontSize: "12px", color: "var(--color-text-dim)", marginTop: "8px" }}>Usually takes 5-10 seconds</p>
        </div>
      )}

      {stage === "teaser" && result && (
        <div style={{ animation: "fadeUp 0.4s both" }}>
          <div style={{ 
            background: "rgba(16,185,129,0.1)", 
            color: "#10b981", 
            padding: "8px 12px", 
            borderRadius: "8px", 
            fontSize: "12px", 
            fontWeight: 700,
            display: "inline-block",
            marginBottom: "20px"
          }}>
            ✅ SCAN COMPLETE
          </div>
          
          <div style={{ marginBottom: "24px" }}>
            <div style={{ fontSize: "11px", color: "var(--color-text-dim)", textTransform: "uppercase", letterSpacing: "1px" }}>Merchant</div>
            <div style={{ fontSize: "24px", fontWeight: 800 }}>{result.extractedData?.merchant || "Unknown Vendor"}</div>
          </div>

          <div style={{ marginBottom: "32px", display: "flex", gap: "40px" }}>
            <div>
              <div style={{ fontSize: "11px", color: "var(--color-text-dim)", textTransform: "uppercase" }}>Total</div>
              <div style={{ fontSize: "20px", fontWeight: 700 }}>${result.extractedData?.total?.toFixed(2) || "0.00"}</div>
            </div>
            <div style={{ opacity: 0.3, filter: "blur(4px)", pointerEvents: "none" }}>
              <div style={{ fontSize: "11px", color: "var(--color-text-dim)", textTransform: "uppercase" }}>Category</div>
              <div style={{ fontSize: "20px", fontWeight: 700 }}>Personal Care</div>
            </div>
          </div>

          <div style={{ 
            background: "rgba(99,102,241,0.05)", 
            border: "1px solid rgba(99,102,241,0.2)", 
            padding: "16px", 
            borderRadius: "12px",
            marginBottom: "24px"
          }}>
            <p style={{ fontSize: "13px", lineHeight: 1.5 }}>
              <strong>Wait, there&apos;s more!</strong> We also extracted 4 line items and applied your tax policies. Create a free account to save this expense.
            </p>
          </div>

          <button 
            onClick={onConversion}
            style={{
              width: "100%",
              padding: "16px",
              borderRadius: "12px",
              background: "linear-gradient(135deg, #0ea5e9, #6366f1)",
              color: "#fff",
              border: "none",
              fontWeight: 700,
              fontSize: "16px",
              cursor: "pointer",
              boxShadow: "0 10px 25px rgba(99,102,241,0.4)"
            }}
          >
            Save to My Account →
          </button>
          
          <button 
            onClick={() => setStage("idle")}
            style={{
              width: "100%",
              marginTop: "12px",
              padding: "8px",
              background: "transparent",
              border: "none",
              color: "var(--color-text-dim)",
              fontSize: "13px",
              cursor: "pointer",
              textDecoration: "underline"
            }}
          >
            Scan another one
          </button>
        </div>
      )}
    </div>
  );
}
