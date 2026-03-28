// ─── CostsCrunch — RegisterPage ─────────────────────────────────────────────────
// Tests verify:
//   - fullName, email, password, confirm-password fields
//   - terms of service checkbox role="checkbox"
//   - passwords must match → error
//   - terms not accepted → error
//   - calls Amplify signUp with { username, password, options.userAttributes }
//   - shows confirmation code step after signUp
//   - calls confirmSignUp → navigates /login
//   - role="progressbar" password strength indicator

import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { signUp, confirmSignUp } from "aws-amplify/auth";

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

// Password strength: 0–4
function calcStrength(pw: string): number {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= 8)  score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return Math.min(score, 4);
}

const STRENGTH_LABELS = ["", "Weak", "Fair", "Good", "Strong"];
const STRENGTH_COLORS = ["", "#ef4444", "#f59e0b", "#0ea5e9", "#10b981"];

export default function RegisterPage() {
  const navigate = useNavigate();

  // Step 1 state
  const [fullName,  setFullName]  = useState("");
  const [email,     setEmail]     = useState("");
  const [password,  setPassword]  = useState("");
  const [confirm,   setConfirm]   = useState("");
  const [terms,     setTerms]     = useState(false);
  const [loading,   setLoading]   = useState(false);
  const [errors,    setErrors]    = useState<Record<string, string>>({});

  // Step 2 state
  const [step, setStep]   = useState<"register" | "confirm">("register");
  const [code, setCode]   = useState("");
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [confirmError, setConfirmError] = useState("");

  const strength = calcStrength(password);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!fullName.trim())          e.fullName = "Name is required";
    if (!email.trim())             e.email    = "Email is required";
    if (!password)                 e.password = "Password is required";
    if (password !== confirm)      e.confirm  = "Passwords do not match";
    if (!terms)                    e.terms    = "You must accept the terms of service";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleRegister = async () => {
    if (!validate()) return;
    setLoading(true);
    try {
      await signUp({
        username: email,
        password,
        options: {
          userAttributes: {
            email,
            name: fullName,
          },
        },
      });
      setStep("confirm");
    } catch (err) {
      setErrors({ global: (err as Error).message });
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!code.trim()) {
      setConfirmError("Verification code is required");
      return;
    }
    setConfirmLoading(true);
    setConfirmError("");
    try {
      await confirmSignUp({ username: email, confirmationCode: code });
      navigate("/login");
    } catch (err) {
      setConfirmError((err as Error).message);
    } finally {
      setConfirmLoading(false);
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
          top: "15%",
          left: "50%",
          transform: "translateX(-50%)",
          width: "700px",
          height: "350px",
          background:
            "radial-gradient(ellipse, rgba(14,165,233,0.1) 0%, transparent 70%)",
          pointerEvents: "none",
        }}
      />

      <div style={{ width: "100%", maxWidth: "440px", animation: "fadeUp 0.4s both" }}>
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
            {step === "register" ? "Create your free account" : "Check your inbox"}
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
          {/* ── STEP 1: Registration form ─────────────────────────────────── */}
          {step === "register" && (
            <>
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

              {/* Full name */}
              <div style={{ marginBottom: "16px" }}>
                <label htmlFor="reg-name" style={LABEL_STYLE}>Full name</label>
                <input
                  id="reg-name"
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Alex Johnson"
                  autoComplete="name"
                  style={{
                    ...INPUT_STYLE,
                    borderColor: errors.fullName ? "rgba(239,68,68,0.5)" : "var(--color-border)",
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "#6366f1")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = errors.fullName ? "rgba(239,68,68,0.5)" : "var(--color-border)")}
                />
                {errors.fullName && (
                  <p style={{ fontSize: "12px", color: "#f87171", marginTop: "5px" }}>
                    {errors.fullName}
                  </p>
                )}
              </div>

              {/* Email */}
              <div style={{ marginBottom: "16px" }}>
                <label htmlFor="reg-email" style={LABEL_STYLE}>Email</label>
                <input
                  id="reg-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  autoComplete="email"
                  style={{
                    ...INPUT_STYLE,
                    borderColor: errors.email ? "rgba(239,68,68,0.5)" : "var(--color-border)",
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "#6366f1")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = errors.email ? "rgba(239,68,68,0.5)" : "var(--color-border)")}
                />
                {errors.email && (
                  <p style={{ fontSize: "12px", color: "#f87171", marginTop: "5px" }}>
                    {errors.email}
                  </p>
                )}
              </div>

              {/* Password + strength */}
              <div style={{ marginBottom: "16px" }}>
                <label htmlFor="reg-password" style={LABEL_STYLE}>Password</label>
                <input
                  id="reg-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min 8 characters"
                  autoComplete="new-password"
                  style={{
                    ...INPUT_STYLE,
                    borderColor: errors.password ? "rgba(239,68,68,0.5)" : "var(--color-border)",
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "#6366f1")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = errors.password ? "rgba(239,68,68,0.5)" : "var(--color-border)")}
                />
                {/* Password strength indicator */}
                {password && (
                  <div style={{ marginTop: "8px" }}>
                    <div
                      role="progressbar"
                      aria-label="Password strength"
                      aria-valuenow={strength}
                      aria-valuemin={0}
                      aria-valuemax={4}
                      style={{
                        height: "4px",
                        background: "var(--color-surface-2)",
                        borderRadius: "2px",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: `${(strength / 4) * 100}%`,
                          background: STRENGTH_COLORS[strength],
                          borderRadius: "2px",
                          transition: "width 0.3s ease, background 0.3s ease",
                        }}
                      />
                    </div>
                    <p style={{ fontSize: "11px", color: STRENGTH_COLORS[strength], marginTop: "4px" }}>
                      {STRENGTH_LABELS[strength]}
                    </p>
                  </div>
                )}
                {errors.password && (
                  <p style={{ fontSize: "12px", color: "#f87171", marginTop: "5px" }}>
                    {errors.password}
                  </p>
                )}
              </div>

              {/* Confirm password */}
              <div style={{ marginBottom: "20px" }}>
                <label htmlFor="reg-confirm" style={LABEL_STYLE}>Confirm password</label>
                <input
                  id="reg-confirm"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Repeat your password"
                  autoComplete="new-password"
                  style={{
                    ...INPUT_STYLE,
                    borderColor: errors.confirm ? "rgba(239,68,68,0.5)" : "var(--color-border)",
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "#6366f1")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = errors.confirm ? "rgba(239,68,68,0.5)" : "var(--color-border)")}
                />
                {errors.confirm && (
                  <p style={{ fontSize: "12px", color: "#f87171", marginTop: "5px" }}>
                    {errors.confirm}
                  </p>
                )}
              </div>

              {/* Terms checkbox */}
              <label
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "10px",
                  cursor: "pointer",
                  marginBottom: errors.terms ? "6px" : "24px",
                }}
              >
                <input
                  type="checkbox"
                  checked={terms}
                  onChange={(e) => setTerms(e.target.checked)}
                  aria-label="I agree to the terms of service and privacy policy"
                  style={{ marginTop: "2px", accentColor: "#6366f1", width: "15px", height: "15px" }}
                />
                <span style={{ fontSize: "13px", color: "var(--color-text-dim)", lineHeight: 1.5 }}>
                  I agree to the{" "}
                  <a href="/terms" style={{ color: "#818cf8" }}>Terms of Service</a>
                  {" "}and{" "}
                  <a href="/privacy" style={{ color: "#818cf8" }}>Privacy Policy</a>
                </span>
              </label>
              {errors.terms && (
                <p style={{ fontSize: "12px", color: "#f87171", marginBottom: "16px" }}>
                  You must accept the terms of service to continue
                </p>
              )}

              <button
                type="button"
                onClick={handleRegister}
                disabled={loading}
                style={{
                  width: "100%",
                  padding: "13px",
                  borderRadius: "10px",
                  border: "none",
                  background: loading
                    ? "rgba(99,102,241,0.4)"
                    : "linear-gradient(135deg, #0ea5e9, #6366f1)",
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
                    Creating account…
                  </>
                ) : (
                  "Create account →"
                )}
              </button>
            </>
          )}

          {/* ── STEP 2: Email confirmation ────────────────────────────────── */}
          {step === "confirm" && (
            <>
              <div
                style={{
                  background: "rgba(14,165,233,0.08)",
                  border: "1px solid rgba(14,165,233,0.2)",
                  borderRadius: "10px",
                  padding: "14px 16px",
                  fontSize: "13px",
                  color: "#38bdf8",
                  marginBottom: "24px",
                  lineHeight: 1.6,
                }}
              >
                ✉️ We sent a <strong>6-digit verification code</strong> to{" "}
                <strong>{email}</strong>. Check your inbox (and spam folder).
              </div>

              {confirmError && (
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
                  {confirmError}
                </div>
              )}

              <div style={{ marginBottom: "24px" }}>
                <label htmlFor="reg-code" style={LABEL_STYLE}>Verification code</label>
                <input
                  id="reg-code"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="000000"
                  style={{
                    ...INPUT_STYLE,
                    fontSize: "24px",
                    fontFamily: "var(--font-display)",
                    letterSpacing: "6px",
                    textAlign: "center",
                    borderColor: confirmError ? "rgba(239,68,68,0.5)" : "var(--color-border)",
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "#6366f1")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = confirmError ? "rgba(239,68,68,0.5)" : "var(--color-border)")}
                />
              </div>

              <button
                type="button"
                onClick={handleConfirm}
                disabled={confirmLoading}
                style={{
                  width: "100%",
                  padding: "13px",
                  borderRadius: "10px",
                  border: "none",
                  background: confirmLoading
                    ? "rgba(99,102,241,0.4)"
                    : "linear-gradient(135deg, #0ea5e9, #6366f1)",
                  color: "#fff",
                  fontWeight: 700,
                  fontSize: "14px",
                  cursor: confirmLoading ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "8px",
                }}
              >
                {confirmLoading ? "Verifying…" : "Verify & sign in →"}
              </button>

              <button
                type="button"
                onClick={() => setStep("register")}
                style={{
                  width: "100%",
                  marginTop: "10px",
                  padding: "11px",
                  borderRadius: "10px",
                  background: "transparent",
                  border: "1px solid var(--color-border)",
                  color: "var(--color-text-dim)",
                  fontSize: "13px",
                  cursor: "pointer",
                }}
              >
                ← Back to registration
              </button>
            </>
          )}
        </div>

        <p style={{ textAlign: "center", marginTop: "24px", fontSize: "13px", color: "var(--color-text-dim)" }}>
          Already have an account?{" "}
          <Link to="/login" style={{ color: "#818cf8", textDecoration: "none", fontWeight: 600 }}>
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}