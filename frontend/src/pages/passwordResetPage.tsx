// ─── CostsCrunch — PasswordResetPage ──────────────────────────────────────────
import { useState } from "react";
import { authApi } from "../helpers/auth-api";

interface Props {
  onNavigate: (page: any) => void;
}

const INPUT_STYLE = {
  width: "100%",
  background: "#070e1c",
  border: "1px solid var(--color-border)",
  borderRadius: "10px",
  padding: "12px 14px",
  color: "var(--color-text)",
  fontSize: "14px",
  outline: "none",
};

const LABEL_STYLE = {
  display: "block",
  fontSize: "11px",
  fontWeight: 600,
  color: "var(--color-text-dim)",
  textTransform: "uppercase",
  letterSpacing: "0.8px",
  marginBottom: "7px",
};

export default function PasswordResetPage({ onNavigate }: Props) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [step, setStep] = useState<"request" | "reset">("request");

  const handleRequest = async () => {
    if (!email.trim()) {
      setError("Email is required");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await authApi.forgotPassword(email);
      setStep("reset");
    } catch (e: any) {
      setError(e.message || "Failed to send reset code");
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    if (!code || !password || !confirm) {
      setError("All fields are required");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await authApi.confirmPassword(email, code, password);
      alert("Password reset successful. Please sign in.");
      onNavigate("login");
    } catch (e: any) {
      setError(e.message || "Failed to reset password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--color-bg)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", fontFamily: "var(--font-body)" }}>
      <div style={{ width: "100%", maxWidth: "420px", animation: "fadeUp 0.4s both" }}>
        <div style={{ textAlign: "center", marginBottom: "40px" }}>
          <div onClick={() => onNavigate("landing")} style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: "24px", background: "linear-gradient(135deg, #0ea5e9, #6366f1)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", marginBottom: "8px", cursor: "pointer" }}>
            CostsCrunch
          </div>
          <p style={{ fontSize: "14px", color: "var(--color-text-dim)" }}>
            {step === "request" ? "Reset your password" : "Enter your new password"}
          </p>
        </div>

        <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "20px", padding: "36px" }}>
          {error && (
            <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: "9px", padding: "11px 14px", fontSize: "13px", color: "#f87171", marginBottom: "20px" }}>
              {error}
            </div>
          )}

          {step === "request" ? (
            <>
              <div style={{ marginBottom: "24px" }}>
                <label style={LABEL_STYLE}>Email address</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" style={INPUT_STYLE} />
              </div>
              <button onClick={handleRequest} disabled={loading} style={{ width: "100%", padding: "13px", borderRadius: "10px", border: "none", background: "linear-gradient(135deg, #0ea5e9, #6366f1)", color: "#fff", fontWeight: 700, cursor: "pointer" }}>
                {loading ? "Sending..." : "Send Reset Code →"}
              </button>
            </>
          ) : (
            <>
              <div style={{ marginBottom: "18px" }}>
                <label style={LABEL_STYLE}>Reset Code</label>
                <input type="text" value={code} onChange={(e) => setCode(e.target.value)} placeholder="000000" style={INPUT_STYLE} />
              </div>
              <div style={{ marginBottom: "18px" }}>
                <label style={LABEL_STYLE}>New Password</label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" style={INPUT_STYLE} />
              </div>
              <div style={{ marginBottom: "24px" }}>
                <label style={LABEL_STYLE}>Confirm New Password</label>
                <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="••••••••" style={INPUT_STYLE} />
              </div>
              <button onClick={handleReset} disabled={loading} style={{ width: "100%", padding: "13px", borderRadius: "10px", border: "none", background: "linear-gradient(135deg, #0ea5e9, #6366f1)", color: "#fff", fontWeight: 700, cursor: "pointer" }}>
                {loading ? "Resetting..." : "Update Password →"}
              </button>
            </>
          )}
        </div>

        <p style={{ textAlign: "center", marginTop: "24px", fontSize: "13px", color: "var(--color-text-dim)" }}>
          Remember your password?{" "}
          <button onClick={() => onNavigate("login")} style={{ background: "none", border: "none", color: "#818cf8", fontWeight: 600, cursor: "pointer" }}>
            Back to sign in
          </button>
        </p>
      </div>
    </div>
  );
}
