// ─── CostsCrunch — MFAPage ─────────────────────────────────────────────────────
// Tests verify:
//   - input labeled /authenticator.*code|totp.*code|6.digit/i
//   - text matching /authenticator app|google authenticator|authy/i
//   - text matching /expires in|time remaining|\d{1,2}s/i
//   - countdown updates every second
//   - submits confirmSignIn({ challengeResponse: code })
//   - navigates /dashboard on success
//   - error on code mismatch
//   - only numeric input accepted
//   - text matching /backup code|recovery code/i

import { useState, useEffect } from "react";
import { authApi } from "../services/api";

interface Props {
  onNavigate: (page: any) => void;
  email?: string;
  session?: string;
}

// TOTP codes expire every 30 seconds; count down within the current window
function getSecondsLeft(): number {
  return 30 - (Math.floor(Date.now() / 1000) % 30);
}

export default function MFAPage({ onNavigate, email, session }: Props) {
  const [code,    setCode]    = useState("");
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");
  const [seconds, setSeconds] = useState(getSecondsLeft);

  // Countdown
  useEffect(() => {
    const id = setInterval(() => setSeconds(getSecondsLeft()), 1000);
    return () => clearInterval(id);
  }, []);

  const handleVerify = async () => {
    if (!code || code.length !== 6) {
      setError("Please enter the 6-digit code from your authenticator app");
      return;
    }
    if (!email || !session) {
      setError("Session expired. Please sign in again.");
      setTimeout(() => onNavigate("login"), 2000);
      return;
    }

    setLoading(true);
    setError("");
    try {
      await authApi.confirmMfa(email, code, session);
      onNavigate("dashboard");
    } catch (e: any) {
      setError(e.message || "Invalid or expired code. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Progress arc
  const pct = seconds / 30;
  const radius = 20;
  const circ = 2 * Math.PI * radius;
  const dash = pct * circ;

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
            "radial-gradient(ellipse, rgba(16,185,129,0.1) 0%, transparent 70%)",
          pointerEvents: "none",
        }}
      />

      <div style={{ width: "100%", maxWidth: "400px", animation: "fadeUp 0.4s both" }}>
        {/* Logo */}
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
            Two-factor authentication
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
          {/* Shield icon + timer */}
          <div style={{ display: "flex", justifyContent: "center", marginBottom: "28px" }}>
            <div style={{ position: "relative", width: "72px", height: "72px" }}>
              {/* Countdown ring */}
              <svg
                width="72"
                height="72"
                viewBox="0 0 72 72"
                style={{ transform: "rotate(-90deg)" }}
                aria-hidden
              >
                <circle
                  cx="36" cy="36" r={radius}
                  fill="none"
                  stroke="var(--color-surface-2)"
                  strokeWidth="4"
                />
                <circle
                  cx="36" cy="36" r={radius}
                  fill="none"
                  stroke={seconds <= 5 ? "#ef4444" : "#10b981"}
                  strokeWidth="4"
                  strokeDasharray={`${dash} ${circ - dash}`}
                  strokeLinecap="round"
                  style={{ transition: "stroke-dasharray 0.9s linear, stroke 0.3s" }}
                />
              </svg>
              {/* Lock icon in centre */}
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "22px",
                }}
              >
                🔐
              </div>
            </div>
          </div>

          {/* Instructions */}
          <div style={{ textAlign: "center", marginBottom: "28px" }}>
            <h2
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 700,
                fontSize: "18px",
                marginBottom: "8px",
              }}
            >
              Enter your authenticator code
            </h2>
            <p style={{ fontSize: "13px", color: "var(--color-text-dim)", lineHeight: 1.6 }}>
              Open your authenticator app (Google Authenticator, Authy, or similar) and enter the
              6-digit code for CostsCrunch.
            </p>
          </div>

          {/* Countdown */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
              marginBottom: "20px",
              fontSize: "12px",
              color: seconds <= 5 ? "#ef4444" : "var(--color-text-dim)",
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            Code expires in{" "}
            <span style={{ fontWeight: 700, fontFamily: "var(--font-display)" }}>
              {seconds}s
            </span>
          </div>

          {/* Error */}
          {error && (
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
                textAlign: "center",
              }}
            >
              {error}
            </div>
          )}

          {/* Code input */}
          <div style={{ marginBottom: "24px" }}>
            <label
              htmlFor="mfa-code"
              style={{
                display: "block",
                fontSize: "11px",
                fontWeight: 600,
                color: "var(--color-text-dim)",
                textTransform: "uppercase",
                letterSpacing: "0.8px",
                marginBottom: "7px",
                textAlign: "center",
              }}
            >
              6-digit authenticator code
            </label>
            <input
              id="mfa-code"
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => {
                const val = e.target.value.replace(/\D/g, "");
                setCode(val);
                if (error) setError("");
              }}
              onKeyDown={(e) => e.key === "Enter" && handleVerify()}
              placeholder="000 000"
              aria-label="6-digit authenticator code (TOTP)"
              autoComplete="one-time-code"
              style={{
                width: "100%",
                background: "#070e1c",
                border: `1px solid ${error ? "rgba(239,68,68,0.5)" : "var(--color-border)"}`,
                borderRadius: "12px",
                padding: "16px",
                color: "var(--color-text)",
                fontSize: "28px",
                fontFamily: "var(--font-display)",
                fontWeight: 700,
                letterSpacing: "8px",
                textAlign: "center",
                outline: "none",
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = "#10b981")}
              onBlur={(e) => (e.currentTarget.style.borderColor = error ? "rgba(239,68,68,0.5)" : "var(--color-border)")}
            />
          </div>

          <button
            type="button"
            onClick={handleVerify}
            disabled={loading}
            aria-label="Verify code"
            style={{
              width: "100%",
              padding: "13px",
              borderRadius: "10px",
              border: "none",
              background: loading
                ? "rgba(16,185,129,0.3)"
                : "linear-gradient(135deg, #059669, #10b981)",
              color: "#fff",
              fontWeight: 700,
              fontSize: "14px",
              cursor: loading ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
            }}
          >
            {loading ? (
              <>
                <span
                  style={{
                    width: "14px",
                    height: "14px",
                    border: "2px solid rgba(255,255,255,0.3)",
                    borderTopColor: "#fff",
                    borderRadius: "50%",
                    animation: "spin 0.7s linear infinite",
                  }}
                />
                Verifying…
              </>
            ) : (
              "Confirm identity →"
            )}
          </button>

          {/* Backup code */}
          <div style={{ marginTop: "20px", textAlign: "center" }}>
            <button
              type="button"
              style={{
                background: "transparent",
                border: "none",
                color: "var(--color-text-dim)",
                fontSize: "12px",
                cursor: "pointer",
                textDecoration: "underline",
                textDecorationColor: "rgba(100,116,139,0.4)",
              }}
            >
              Use a backup code instead
            </button>
          </div>
        </div>

        <p
          style={{
            textAlign: "center",
            marginTop: "20px",
            fontSize: "12px",
            color: "var(--color-text-dim)",
          }}
        >
          Lost access to your authenticator?{" "}
          <a href="mailto:support@CostsCrunch.io" style={{ color: "#818cf8" }}>
            Contact support
          </a>
        </p>
      </div>
    </div>
  );
}