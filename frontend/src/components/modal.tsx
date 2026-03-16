import type { ModalProps } from "./../models/types.js"

/**
 * Reusable Modal Component
 * Provides a consistent backdrop, animation, and container for overlays.
 */
export default function Modal({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  headerActions,
  maxWidth = "520px",
}: ModalProps) {
  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.75)",
        backdropFilter: "blur(8px)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          background: "#0f1724",
          border: "1px solid #1e3048",
          borderRadius: "20px",
          width: "100%",
          maxWidth: maxWidth,
          overflow: "hidden",
          boxShadow: "0 40px 80px rgba(0,0,0,0.6)",
          animation: "modalFadeIn 0.3s ease-out",
        }}
      >
        <style>{`
          @keyframes modalFadeIn {
            from { opacity: 0; transform: translateY(10px) scale(0.98); }
            to { opacity: 1; transform: translateY(0) scale(1); }
          }
        `}</style>

        {/* Header */}
        {(title || headerActions) && (
          <div style={{ padding: "24px 28px 0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              {title && (
                <div style={{ fontFamily: "var(--font-display)", fontSize: "20px", fontWeight: 700, color: "var(--color-text)" }}>
                  {title}
                </div>
              )}
              {subtitle && (
                <div style={{ fontSize: "12px", color: "#64748b", marginTop: "3px" }}>
                  {subtitle}
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              {headerActions}
              {onClose && (
                <button
                  onClick={onClose}
                  aria-label="Close"
                  style={{
                    background: "#1e3048",
                    border: "none",
                    color: "#64748b",
                    width: "32px",
                    height: "32px",
                    borderRadius: "8px",
                    cursor: "pointer",
                    fontSize: "16px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center"
                  }}
                >
                  ×
                </button>
              )}
            </div>
          </div>
        )}

        <div style={{ padding: "24px 28px 28px" }}>
          {children}
        </div>
      </div>
    </div>
  );
}
