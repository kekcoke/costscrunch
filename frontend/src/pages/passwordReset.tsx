// ─── CostsCrunch — PasswordResetPage ───────────────────────────────────────────
// Tests verify:
//   Step 1:
//     - email input
//     - calls resetPassword({ username: email })
//     - shows confirmation message after send
//     - error when email blank
//   Step 2:
//     - verification code, new password, confirm password fields
//     - calls confirmResetPassword({ username, confirmationCode, newPassword })
//     - navigates /login after success
//     - error when passwords don't match
//   - link matching /back.*login|return.*login/i

import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { authApi } from "../services/api";

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
  fontWeight: 600 as const,
  color: "var(--color-text-dim)" as const,
  textTransform: "uppercase" as const,
  letterSpacing: "0.8px",
  marginBottom: "7px",
};

type Step = "request" | "sent";

export default function PasswordResetPage() {
  const navigate = useNavigate();

  const [step,    setStep]    = useState<Step>("request");
  const [email,   setEmail]   = useState("");
  const [loading, setLoading] = useState(false);
  const [errors,  setErrors]  = useState<Record<string, string>>({});

  // Step 2 state
  const [code,        setCode]        = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPw,   setConfirmPw]   = useState("");

  const handleRequest = async () => {
    if (!email.trim()) {
      setErrors({ email: "Email is required" });
      return;
    }
    setLoading(true);
    setErrors({});
    try {
      await authApi.forgotPassword(email);
      setStep("sent");
    } catch (e: any) {
      setErrors({ global: e.message || "Failed to send reset code" });
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    const errs: Record<string, string> = {};
    if (!code.trim())          errs.code = "Verification code is required";
    if (!newPassword)          errs.newPassword = "New password is required";
    if (newPassword !== confirmPw) errs.confirmPw = "Passwords do not match";
    if (Object.keys(errs).length) { setErrors(errs); return; }

    setLoading(true);
    setErrors({});
    try {
      await authApi.confirmPassword(email, code, newPassword);
      alert("Password updated successfully. Please log in.");
      navigate("/login");
    } catch (e: any) {
      setErrors({ global: e.message || "Failed to reset password" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--color-bg)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        fontFamily: "var(--font-body)",
      }}
    >
      <div
        aria-hidden
        style={{
          position: "fixed",
          top: "20%",
          left: "50%",
          transform: "translateX(-50%)",
          width: "500px",
          height: "300px",
          background:
            "radial-gradient(ellipse, rgba(245,158,11,0.08) 0%, transparent 70%)",
          pointerEvents: "none",
        }}
      />

      <div style={{ width: "100%", maxWidth: "420px", animation: "fadeUp 0.4s both" }}>
        <div style={{ textAlign: "center", marginBottom: "36px" }}>
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 800,
              fontSize: "24px",
              background: "linear-gradient(135deg, #0ea5e9, #6366f1)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              marginBottom: "8px",
            }}
          >
            CostsCrunch
          </div>
          <p style={{ fontSize: "14px", color: "var(--color-text-dim)" }}>
            {step === "request" ? "Reset your password" : "Check your email"}
          </p>
        </div>

        <div
          style={{
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: "20px",
            padding: "36px",
          }}
        >
          {errors.global && (
            <div
              role="alert"
              style={{
                background: "rgba(239,68,68,0.1)",
                border: "1px solid rgba(239,68,68,0.25)",
                borderRadius: "9px",
                padding: "11px 14px",
                fontSize: "13px",
                color: "#f87171",
                marginBottom: "20px",
              }}
            >
              {errors.global}
            </div>
          )}

          {step === "request" ? (
            <>
              <div style={{ marginBottom: "24px" }}>
                <label htmlFor="reset-email" style={LABEL_STYLE}>Email address</label>
                <input
                  id="reset-email"
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setErrors({}); }}
                  placeholder="you@company.com"
                  style={{
                    ...INPUT_STYLE,
                    borderColor: errors.email ? "rgba(239,68,68,0.5)" : "var(--color-border)",
                  }}
                />
                {errors.email && (
                  <p style={{ fontSize: "12px", color: "#f87171", marginTop: "5px" }}>{errors.email}</p>
                )}
              </div>
              <button
                onClick={handleRequest}
                disabled={loading}
                style={{
                  width: "100%",
                  padding: "13px",
                  borderRadius: "10px",
                  border: "none",
                  background: "linear-gradient(135deg, #0ea5e9, #6366f1)",
                  color: "#fff",
                  fontWeight: 700,
                  cursor: loading ? "not-allowed" : "pointer",
                }}
              >
                {loading ? "Sending..." : "Send reset code →"}
              </button>
            </>
          ) : (
            <>
              <div style={{ marginBottom: "16px" }}>
                <label style={LABEL_STYLE}>Verification code</label>
                <input
                  type="text"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="000000"
                  style={{
                    ...INPUT_STYLE,
                    borderColor: errors.code ? "rgba(239,68,68,0.5)" : "var(--color-border)",
                  }}
                />
              </div>
              <div style={{ marginBottom: "16px" }}>
                <label style={LABEL_STYLE}>New password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Min 8 characters"
                  style={{
                    ...INPUT_STYLE,
                    borderColor: errors.newPassword ? "rgba(239,68,68,0.5)" : "var(--color-border)",
                  }}
                />
              </div>
              <div style={{ marginBottom: "24px" }}>
                <label style={LABEL_STYLE}>Confirm password</label>
                <input
                  type="password"
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                  placeholder="Repeat password"
                  style={{
                    ...INPUT_STYLE,
                    borderColor: errors.confirmPw ? "rgba(239,68,68,0.5)" : "var(--color-border)",
                  }}
                />
              </div>
              <button
                onClick={handleConfirm}
                disabled={loading}
                style={{
                  width: "100%",
                  padding: "13px",
                  borderRadius: "10px",
                  border: "none",
                  background: "linear-gradient(135deg, #0ea5e9, #6366f1)",
                  color: "#fff",
                  fontWeight: 700,
                  cursor: loading ? "not-allowed" : "pointer",
                }}
              >
                {loading ? "Saving..." : "Set new password →"}
              </button>
            </>
          )}
        </div>

        <p style={{ textAlign: "center", marginTop: "24px", fontSize: "13px", color: "var(--color-text-dim)" }}>
          <Link to="/login" style={{ color: "#818cf8", textDecoration: "none", fontWeight: 600 }}>
            ← Back to login
          </Link>
        </p>
      </div>
    </div>
  );
}
