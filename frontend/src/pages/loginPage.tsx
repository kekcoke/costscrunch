// ─── CostsCrunch — LoginPage ────────────────────────────────────────────────────
import { useState } from "react";
import { signIn, signInWithRedirect } from "aws-amplify/auth";

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

export default function LoginPage({ onNavigate }: Props) {
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
        onNavigate("mfa");
        return;
      }

      onNavigate("dashboard");
    } catch (e) {
      setError((e as Error).message ?? "Sign in failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleOAuth = (provider: "Google" | "GitHub") => {
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
        <div style={{ textAlign: "center", marginBottom: "40px" }}>
          <div
            onClick={() => onNavigate("landing")}
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 800,
              fontSize: "24px",
              letterSpacing: "-0.5px",
              background: "linear-gradient(135deg, #0ea5e9, #6366f1)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              marginBottom: "8px",
              cursor: "pointer"
            }}
          >
            CostsCrunch
          </div>
          <p style={{ fontSize: "14px", color: "var(--color-text-dim)" }}>
            Sign in to your account
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
          <div style={{ display: "flex", gap: "10px", marginBottom: "24px" }}>
            <button
              type="button"
              onClick={() => handleOAuth("Google")}
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
              }}
            >
              Google
            </button>
            <button
              type="button"
              onClick={() => handleOAuth("GitHub")}
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
              }}
            >
              GitHub
            </button>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "24px" }}>
            <div style={{ flex: 1, height: "1px", background: "var(--color-border-dim)" }} />
            <span style={{ fontSize: "11px", color: "var(--color-text-dim)" }}>or use email</span>
            <div style={{ flex: 1, height: "1px", background: "var(--color-border-dim)" }} />
          </div>

          {error && (
            <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: "9px", padding: "11px 14px", fontSize: "13px", color: "#f87171", marginBottom: "20px" }}>
              {error}
            </div>
          )}

          <div style={{ marginBottom: "18px" }}>
            <label style={LABEL_STYLE}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              style={{ ...INPUT_STYLE, borderColor: fieldErrors.email ? "#f87171" : "var(--color-border)" }}
            />
          </div>

          <div style={{ marginBottom: "8px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "7px" }}>
              <label style={{ ...LABEL_STYLE, marginBottom: 0 }}>Password</label>
              <button onClick={() => onNavigate("password-reset")} style={{ background: "none", border: "none", fontSize: "12px", color: "#818cf8", cursor: "pointer" }}>
                Forgot?
              </button>
            </div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              style={{ ...INPUT_STYLE, borderColor: fieldErrors.password ? "#f87171" : "var(--color-border)" }}
            />
          </div>

          <button
            onClick={handleSignIn}
            disabled={loading}
            style={{
              width: "100%",
              marginTop: "24px",
              padding: "13px",
              borderRadius: "10px",
              border: "none",
              background: "linear-gradient(135deg, #0ea5e9, #6366f1)",
              color: "#fff",
              fontWeight: 700,
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Signing in..." : "Sign in →"}
          </button>
        </div>

        <p style={{ textAlign: "center", marginTop: "24px", fontSize: "13px", color: "var(--color-text-dim)" }}>
          No account?{" "}
          <button onClick={() => onNavigate("register")} style={{ background: "none", border: "none", color: "#818cf8", fontWeight: 600, cursor: "pointer" }}>
            Create one free
          </button>
        </p>
      </div>
    </div>
  );
}
