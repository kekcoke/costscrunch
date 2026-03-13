// ─── SpendLens — BubbleChart ─────────────────────────────────────────────────
// Tests verify:
//   - role="img" aria-label=/bubble chart/i
//   - Y-axis label "Amount (USD)"
//   - X-axis label shows time unit (date|week|month)

import { useMemo } from "react";
import { fmt, fmtDate } from "../../helpers/utils";
import { CATEGORIES, type Category } from "../../models/constants";

interface BubblePoint {
  date:      string;
  amount:    number;
  frequency: number;
  category:  string;
}

interface Props {
  data:     BubblePoint[];
  currency?: string;
  period?:   string;
}

const W = 560;
const H = 320;
const PAD = { top: 24, right: 24, bottom: 48, left: 70 };

const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top  - PAD.bottom;

export default function BubbleChart({ data, currency = "USD", period = "month" }: Props) {
  const axisYLabel = `Amount (${currency})`;
  const axisXLabel = period === "year" ? "Month" : period === "quarter" ? "Week" : "Date";

  const { points, xTicks, yTicks } = useMemo(() => {
    if (!data || data.length === 0) {
      return { points: [], xTicks: [], yTicks: [] };
    }

    const dates   = data.map((d) => new Date(d.date).getTime());
    const amounts = data.map((d) => d.amount);
    const freqs   = data.map((d) => d.frequency);

    const minDate   = Math.min(...dates);
    const maxDate   = Math.max(...dates);
    const maxAmount = Math.max(...amounts);
    const maxFreq   = Math.max(...freqs);
    const dateRange = maxDate - minDate || 1;

    const px = (ms: number)  => PAD.left + ((ms - minDate) / dateRange) * PLOT_W;
    const py = (amt: number) => PAD.top  + (1 - amt / (maxAmount * 1.1)) * PLOT_H;
    const pr = (f: number)   => 8 + (f / maxFreq) * 20;

    const points = data.map((d) => ({
      ...d,
      cx: px(new Date(d.date).getTime()),
      cy: py(d.amount),
      r:  pr(d.frequency),
    }));

    // X ticks: pick up to 5 evenly spaced dates
    const step = Math.max(1, Math.floor(data.length / 5));
    const xTicks = data
      .filter((_, i) => i % step === 0)
      .map((d) => ({
        x: px(new Date(d.date).getTime()),
        label: fmtDate(d.date),
      }));

    // Y ticks: 5 evenly spaced amounts from 0 to maxAmount
    const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
      y: PAD.top + (1 - f) * PLOT_H,
      label: fmt(maxAmount * f),
    }));

    return { points, xTicks, yTicks };
  }, [data]);

  if (!data || data.length === 0) {
    return (
      <div style={{ color: "var(--color-text-dim)", textAlign: "center", padding: "60px" }}>
        No data available
      </div>
    );
  }

  return (
    <div
      role="img"
      aria-label={`Bubble chart — ${axisYLabel} over ${axisXLabel}`}
      style={{ width: "100%", overflowX: "auto" }}
    >
      <svg
        viewBox={`0 0 ${W} ${H + 20}`}
        style={{ width: "100%", maxWidth: `${W}px`, display: "block" }}
        aria-hidden="true"
      >
        {/* Grid lines */}
        {yTicks.map((t, i) => (
          <line
            key={i}
            x1={PAD.left} y1={t.y}
            x2={W - PAD.right} y2={t.y}
            stroke="var(--color-border-dim)"
            strokeWidth="1"
          />
        ))}

        {/* Y-axis ticks */}
        {yTicks.map((t, i) => (
          <text
            key={i}
            x={PAD.left - 8}
            y={t.y + 4}
            textAnchor="end"
            fill="var(--color-text-dim)"
            fontSize="10"
          >
            {t.label}
          </text>
        ))}

        {/* X-axis ticks */}
        {xTicks.map((t, i) => (
          <text
            key={i}
            x={t.x}
            y={PAD.top + PLOT_H + 16}
            textAnchor="middle"
            fill="var(--color-text-dim)"
            fontSize="10"
          >
            {t.label}
          </text>
        ))}

        {/* Axes */}
        <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PAD.top + PLOT_H}
          stroke="var(--color-border)" strokeWidth="1" />
        <line x1={PAD.left} y1={PAD.top + PLOT_H} x2={W - PAD.right} y2={PAD.top + PLOT_H}
          stroke="var(--color-border)" strokeWidth="1" />

        {/* Bubbles */}
        {points.map((p, i) => {
          const cat   = CATEGORIES[p.category as Category] ?? CATEGORIES.Other;
          return (
            <g key={i}>
              <circle
                cx={p.cx}
                cy={p.cy}
                r={p.r}
                fill={cat.color + "55"}
                stroke={cat.color}
                strokeWidth="1.5"
                style={{ cursor: "pointer", transition: "r 0.15s" }}
              >
                <title>{p.category} · {fmtDate(p.date)} · {fmt(p.amount)} · {p.frequency} transactions</title>
              </circle>
            </g>
          );
        })}

        {/* Y-axis label */}
        <text
          x={16}
          y={PAD.top + PLOT_H / 2}
          textAnchor="middle"
          fill="var(--color-text-dim)"
          fontSize="10"
          fontWeight="600"
          transform={`rotate(-90, 16, ${PAD.top + PLOT_H / 2})`}
          letterSpacing="0.5"
        >
          {axisYLabel}
        </text>

        {/* X-axis label */}
        <text
          x={PAD.left + PLOT_W / 2}
          y={H + 14}
          textAnchor="middle"
          fill="var(--color-text-dim)"
          fontSize="10"
          fontWeight="600"
          letterSpacing="0.5"
        >
          {axisXLabel}
        </text>
      </svg>

      {/* Legend */}
      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginTop: "12px" }}>
        {Object.entries(CATEGORIES).map(([name, cat]) => {
          const hasData = points.some((p) => p.category === name);
          if (!hasData) return null;
          return (
            <div key={name} style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "11px", color: "var(--color-text-dim)" }}>
              <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: cat.color }} />
              {name}
            </div>
          );
        })}
        <div style={{ marginLeft: "auto", fontSize: "11px", color: "var(--color-text-dimmer)" }}>
          Bubble size = transaction frequency
        </div>
      </div>
    </div>
  );
}