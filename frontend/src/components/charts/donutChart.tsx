// ─── CostsCrunch — DonutChart Component ──────────────────────────────────────
import { fmt } from "../../helpers/utils";
import type { DonutChartProps } from "../../models/interfaceProps";

const RADIUS   = 54;
const CX       = 70;
const CY       = 70;
const CIRC     = 2 * Math.PI * RADIUS;
const STROKE_W = 20;

export default function DonutChart({ data }: DonutChartProps) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  if (total === 0) return null;

  const slices = data.map((d, i) => {
    const start = data
      .slice(0, i)
      .reduce((sum, item) => sum + item.value, 0);

    const pct  = d.value / total;
    const dash = pct * CIRC;
    const gap  = CIRC - dash;
    const rot  = (start / total) * 360 - 90;

    return { ...d, dash, gap, rot };
  });

  return (
    <div style={{ display: "flex", gap: "24px", alignItems: "center" }}>
      <svg
        width="140"
        height="140"
        viewBox="0 0 140 140"
        role="img"
        aria-label="Spending by category donut chart"
      >
        {slices.map((s) => (
          <circle
            key={s.label}
            cx={CX}
            cy={CY}
            r={RADIUS}
            fill="none"
            stroke={s.color}
            strokeWidth={STROKE_W}
            strokeDasharray={`${s.dash} ${s.gap}`}
            transform={`rotate(${s.rot} ${CX} ${CY})`}
            style={{ transition: "stroke-dasharray 0.8s ease" }}
          >
            <title>
              {s.label}: {fmt(s.value)}
            </title>
          </circle>
        ))}

        <text
          x={CX}
          y={CY - 4}
          textAnchor="middle"
          fill="#f1f5f9"
          fontSize="15"
          fontWeight="800"
          fontFamily="var(--font-display)"
        >
          {fmt(total)}
        </text>

        <text
          x={CX}
          y={CY + 14}
          textAnchor="middle"
          fill="#475569"
          fontSize="10"
        >
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
                  width: "8px",
                  height: "8px",
                  borderRadius: "2px",
                  background: d.color,
                  flexShrink: 0,
                }}
              />
              <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                {d.label}
              </span>
            </div>

            <span
              style={{
                fontSize: "12px",
                fontWeight: 700,
                color: "var(--color-text)",
              }}
            >
              {fmt(d.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}