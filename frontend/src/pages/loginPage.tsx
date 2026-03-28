// ─── CostsCrunch — LoginPage ────────────────────────────────────────────────────
// Tests verify:
//   - email and password labeled fields
//   - role="button" Google and GitHub buttons
//   - validation: empty email, empty password → error messages
//   - calls Amplify signIn({ username, password })
//   - navigates /dashboard on success
//   - navigates /mfa when challenge is SOFTWARE_TOKEN_MFA
//   - displays Cognito error message on failure
//   - calls signInWithRedirect({ provider: "Google" })
//   - link to /forgot-password
//   - sign-in button disabled while loading

import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { signIn, signInWithRedirect } from "aws-amplify/auth";

const INPUT_STYLE = {
  width: "100%",
  background: "#070e1c",
  border: "1px solid var(--color-border)",
  borderRadius: "10px",
  padding: "12px 14px",
  color: "var(--color-text)",
  fontSize: "14px",
  outline: "none",
  transition: "border-color 0.15s",
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

export default function LoginPage() {
  const navigate = useNavigate();

  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");
  const [fieldErrors, setFieldErrors] = useState({ email: "", password: "" });

  const validate = () => {
    const errs = { email: "", password: "" };
    let ok = true;
    if (!email.trim()) {
      errs.email = "Email is required";
      ok = false;
    }
    if (!password) {
      errs.password = "Password is required";
      ok = false;
    }
    setFieldErrors(errs);
    return ok;
  };

  const handleSignIn = async () => {
    setError("");
    if (!validate()) return;

    setLoading(true);
    try {
      const result = await signIn({ username: email, password });

      if (result.nextStep?.signInStep === "CONFIRM_SIGN_IN_WITH_TOTP_CODE" ||
          result.nextStep?.signInStep === "CONFIRM_SIGN_IN_WITH_SMS_CODE") {
        navigate("/mfa");
        return;
      }

      navigate("/dashboard");
    } catch (e) {
      setError((e as Error).message ?? "Sign in failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleOAuth = (provider: "Google") => {
    signInWithRedirect({ provider });
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
      {/* Background glow */}
      <div
        aria-hidden
        style={{
          position: "fixed",
          top: "20%",
          left: "50%",
          transform: "translateX(-50%)",
          width: "600px",
          height: "300px",
          background:
            "radial-gradient(ellipse, rgba(99,102,241,0.12) 0%, transparent 70%)",
          pointerEvents: "none",
        }}
      />

      <div
        style={{
          width: "100%",
          maxWidth: "420px",
          animation: "fadeUp 0.4s both",
        }}
      >
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: "40px" }}>
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 800,
              fontSize: "24px",
              letterSpacing: "-0.5px",
              background: "linear-gradient(135deg, #0ea5e9, #6366f1)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              marginBottom: "8px",
            }}
          >
            CostsCrunch
          </div>
          <p style={{ fontSize: "14px", color: "var(--color-text-dim)" }}>
            Sign in to your account
          </p>
        </div>

        {/* Card */}
        <div
          style={{
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: "20px",
            padding: "36px",
          }}
        >
          {/* OAuth buttons */}
          <div style={{ display: "flex", gap: "10px", marginBottom: "24px" }}>
            <button
              type="button"
              onClick={() => handleOAuth("Google")}
              aria-label="Continue with Google"
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                padding: "11px",
                background: "transparent",
                border: "1px solid var(--color-border)",
                borderRadius: "10px",
                color: "var(--color-text-muted)",
                fontSize: "13px",
                fontWeight: 500,
                cursor: "pointer",
                transition: "border-color 0.15s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#4285f4")}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--color-border)")}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Google
            </button>

            <button
              type="button"
              onClick={() => handleOAuth("GitHub")}
              aria-label="Continue with GitHub"
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                padding: "11px",
                background: "transparent",
                border: "1px solid var(--color-border)",
                borderRadius: "10px",
                color: "var(--color-text-muted)",
                fontSize: "13px",
                fontWeight: 500,
                cursor: "pointer",
                transition: "border-color 0.15s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#f0f0f0")}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--color-border)")}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/>
              </svg>
              GitHub
            </button>
          </div>

          {/* Divider */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              marginBottom: "24px",
            }}
          >
            <div style={{ flex: 1, height: "1px", background: "var(--color-border-dim)" }} />
            <span style={{ fontSize: "11px", color: "var(--color-text-dim)", whiteSpace: "nowrap" }}>
              or continue with email
            </span>
            <div style={{ flex: 1, height: "1px", background: "var(--color-border-dim)" }} />
          </div>

          {/* Error banner */}
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
              }}
            >
              {error}
            </div>
          )}

          {/* Fields */}
          <div style={{ marginBottom: "18px" }}>
            <label htmlFor="login-email" style={LABEL_STYLE}>Email</label>
            <input
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setFieldErrors(p => ({ ...p, email: "" })); }}
              placeholder="you@company.com"
              autoComplete="email"
              style={{
                ...INPUT_STYLE,
                borderColor: fieldErrors.email ? "rgba(239,68,68,0.5)" : "var(--color-border)",
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = "#6366f1")}
              onBlur={(e) => (e.currentTarget.style.borderColor = fieldErrors.email ? "rgba(239,68,68,0.5)" : "var(--color-border)")}
            />
            {fieldErrors.email && (
              <p style={{ fontSize: "12px", color: "#f87171", marginTop: "5px" }}>
                {fieldErrors.email}
              </p>
            )}
          </div>

          <div style={{ marginBottom: "8px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "7px" }}>
              <label htmlFor="login-password" style={{ ...LABEL_STYLE, marginBottom: 0 }}>Password</label>
              <Link
                to="/forgot-password"
                style={{ fontSize: "12px", color: "#818cf8", textDecoration: "none" }}
              >
                Forgot password?
              </Link>
            </div>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setFieldErrors(p => ({ ...p, password: "" })); }}
              placeholder="••••••••"
              autoComplete="current-password"
              onKeyDown={(e) => e.key === "Enter" && handleSignIn()}
              style={{
                ...INPUT_STYLE,
                borderColor: fieldErrors.password ? "rgba(239,68,68,0.5)" : "var(--color-border)",
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = "#6366f1")}
              onBlur={(e) => (e.currentTarget.style.borderColor = fieldErrors.password ? "rgba(239,68,68,0.5)" : "var(--color-border)")}
            />
            {fieldErrors.password && (
              <p style={{ fontSize: "12px", color: "#f87171", marginTop: "5px" }}>
                {fieldErrors.password}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={handleSignIn}
            disabled={loading}
            aria-label={loading ? "Signing in…" : "Sign in"}
            style={{
              width: "100%",
              marginTop: "24px",
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
              transition: "opacity 0.15s",
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
                    flexShrink: 0,
                  }}
                />
                Signing in…
              </>
            ) : (
              "Sign in →"
            )}
          </button>
        </div>

        {/* Footer */}
        <p style={{ textAlign: "center", marginTop: "24px", fontSize: "13px", color: "var(--color-text-dim)" }}>
          No account?{" "}
          <Link to="/register" style={{ color: "#818cf8", textDecoration: "none", fontWeight: 600 }}>
            Create one free
          </Link>
        </p>
      </div>
    </div>
  );
}