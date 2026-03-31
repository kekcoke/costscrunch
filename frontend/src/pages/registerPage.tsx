// ─── CostsCrunch — RegisterPage ─────────────────────────────────────────────────
import { useState } from "react";
import { authApi } from "../services/api";
import { guestSession } from "../helpers/guestSession";

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

export default function RegisterPage({ onNavigate }: Props) {
  const [fullName,  setFullName]  = useState("");
  const [email,     setEmail]     = useState("");
  const [password,  setPassword]  = useState("");
  const [confirm,   setConfirm]   = useState("");
  const [terms,     setTerms]     = useState(false);
  const [loading,   setLoading]   = useState(false);
  const [errors,    setErrors]    = useState<Record<string, string>>({});
  const [step, setStep]   = useState<"register" | "confirm">("register");
  const [code, setCode]   = useState("");

  const validate = () => {
    const e: Record<string, string> = {};
    if (!fullName.trim()) e.fullName = "Name is required";
    if (!email.trim())    e.email    = "Email is required";
    if (!password)        e.password = "Password is required";
    if (password !== confirm) e.confirm = "Passwords do not match";
    if (!terms)           e.terms    = "Accept terms to continue";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleRegister = async () => {
    if (!validate()) return;
    setLoading(true);
    try {
      await authApi.register(email, password, fullName);
      setStep("confirm");
    } catch (err) {
      setErrors({ global: (err as Error).message });
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await authApi.confirm(email, code);
      
      // Auto-login or just prompt for login? 
      // If the backend /confirm doesn't return tokens, we stay on login path.
      // But we can clear guest session here if we want the user to start fresh,
      // or wait for the actual login. 
      // Based on the plan, claiming happens after success.
      
      onNavigate("login");
    } catch (err) {
      setErrors({ confirm: (err as Error).message });
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
      <div style={{ width: "100%", maxWidth: "440px", animation: "fadeUp 0.4s both" }}>
        <div style={{ textAlign: "center", marginBottom: "36px" }}>
          <div
            onClick={() => onNavigate("landing")}
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 800,
              fontSize: "24px",
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
            {step === "register" ? "Create your free account" : "Check your inbox"}
          </p>
        </div>

        <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "20px", padding: "36px" }}>
          {step === "register" ? (
            <>
              {errors.global && <div style={{ color: "#f87171", marginBottom: "20px", fontSize: "13px" }}>{errors.global}</div>}
              <div style={{ marginBottom: "16px" }}>
                <label style={LABEL_STYLE}>Full name</label>
                <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} style={INPUT_STYLE} />
              </div>
              <div style={{ marginBottom: "16px" }}>
                <label style={LABEL_STYLE}>Email</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={INPUT_STYLE} />
              </div>
              <div style={{ marginBottom: "16px" }}>
                <label style={LABEL_STYLE}>Password</label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={INPUT_STYLE} />
              </div>
              <div style={{ marginBottom: "20px" }}>
                <label style={LABEL_STYLE}>Confirm password</label>
                <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} style={INPUT_STYLE} />
              </div>
              <label style={{ display: "flex", gap: "10px", marginBottom: "24px", cursor: "pointer", fontSize: "13px" }}>
                <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
                <span>I agree to terms</span>
              </label>
              <button onClick={handleRegister} disabled={loading} style={{ width: "100%", padding: "13px", borderRadius: "10px", border: "none", background: "linear-gradient(135deg, #0ea5e9, #6366f1)", color: "#fff", fontWeight: 700, cursor: "pointer" }}>
                {loading ? "Creating..." : "Create account →"}
              </button>
            </>
          ) : (
            <>
              <div style={{ color: "#38bdf8", marginBottom: "24px", fontSize: "13px" }}>Enter the code sent to {email}</div>
              <input type="text" value={code} onChange={(e) => setCode(e.target.value)} placeholder="000000" style={{ ...INPUT_STYLE, textAlign: "center", fontSize: "24px", letterSpacing: "6px" }} />
              <button onClick={handleConfirm} style={{ width: "100%", marginTop: "24px", padding: "13px", borderRadius: "10px", border: "none", background: "linear-gradient(135deg, #0ea5e9, #6366f1)", color: "#fff", fontWeight: 700, cursor: "pointer" }}>
                Verify & Sign in →
              </button>
            </>
          )}
        </div>

        <p style={{ textAlign: "center", marginTop: "24px", fontSize: "13px", color: "var(--color-text-dim)" }}>
          Already have an account?{" "}
          <button onClick={() => onNavigate("login")} style={{ background: "none", border: "none", color: "#818cf8", fontWeight: 600, cursor: "pointer" }}>
            Sign in
          </button>
        </p>
      </div>
    </div>
  );
}
