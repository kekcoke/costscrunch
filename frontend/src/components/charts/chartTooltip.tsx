import React from "react";

interface ChartTooltipProps {
  visible: boolean;
  x: number;
  y: number;
  content: React.ReactNode;
}

export default function ChartTooltip({ visible, x, y, content }: ChartTooltipProps) {
  if (!visible) return null;

  return (
    <div
      style={{
        position: "fixed",
        left: x + 12,
        top: y - 12,
        zIndex: 1000,
        pointerEvents: "none",
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: "8px",
        padding: "8px 12px",
        boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
        fontSize: "12px",
        color: "var(--color-text)",
        minWidth: "120px",
        animation: "fadeIn 0.15s ease-out"
      }}
    >
      {content}
    </div>
  );
}
