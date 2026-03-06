// ─── CostsCrunch — DonutChart Component ──────────────────────────────────────
import { fmt } from "../helpers/utils";
import type { DonutChartProps } from "../models/interfaceProps";
import { useState } from "react";

const RADIUS   = 54;
const CX       = 70;
const CY       = 70;
const CIRC     = 2 * Math.PI * RADIUS;
const STROKE_W = 20;

export default function DonutChart({ data }: DonutChartProps) {
  const [cumulativeOffset, setCumulativeOffset] = useState(0);
  const total = data.reduce((sum, d) => sum + d.value, 0);
  if (total === 0) return null;

  const updateOffset = (newOffset: number) => {
    setCumulativeOffset(newOffset);
  };

  return (
    <div style={{ display: "flex", gap: "24px", alignItems: "center" }}>
      <svg
        width="140"
        height="140"
        viewBox="0 0 140 140"
        role="img"
        aria-label="Spending by category donut chart"
      >
        {data.map((d) => {
          const pct  = d.value / total;
          const dash = pct * CIRC;
          const gap  = CIRC - dash;
          const rot  = (cumulativeOffset / total) * 360 - 90;
          updateOffset(d.value);

          return (
            <circle
              key={d.label}
              cx={CX}
              cy={CY}
              r={RADIUS}
              fill="none"
              stroke={d.color}
              strokeWidth={STROKE_W}
              strokeDasharray={`${dash} ${gap}`}
              strokeDashoffset={0}
              transform={`rotate(${rot} ${CX} ${CY})`}
              style={{ transition: "stroke-dasharray 0.8s ease" }}
            >
              <title>{d.label}: {fmt(d.value)}</title>
            </circle>
          );
        })}
        <text
          x={CX} y={CY - 4}
          textAnchor="middle"
          fill="#f1f5f9"
          fontSize="15"
          fontWeight="800"
          fontFamily="var(--font-display)"
        >
          {fmt(total)}
        </text>
        <text x={CX} y={CY + 14} textAnchor="middle" fill="#475569" fontSize="10">
          total
        </text>
      </svg>

      <div style={{ flex: 1 }}>
        {data.map((d) => (
          <div
            key={d.label}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "8px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <div
                style={{
                  width: "8px", height: "8px",
                  borderRadius: "2px",
                  background: d.color,
                  flexShrink: 0,
                }}
              />
              <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                {d.label}
              </span>
            </div>
            <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--color-text)" }}>
              {fmt(d.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}