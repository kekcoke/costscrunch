// ─── Global Loading Spinner ──────────────────────────────────────────────────
export function LoadingSpinner({ size = "24px", color = "var(--color-indigo)" }) {
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "20px" }}>
      <div style={{ 
        width: size, 
        height: size, 
        border: `3px solid ${color}22`, 
        borderTop: `3px solid ${color}`, 
        borderRadius: "50%", 
        animation: "spin 0.8s linear infinite" 
      }} />
    </div>
  );
}
