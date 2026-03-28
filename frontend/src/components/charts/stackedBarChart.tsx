// ─── SpendLens — StackedBarChart ─────────────────────────────────────────────
import { useMemo, useState } from "react";
import { fmt } from "../../helpers/utils.js";
import { CATEGORIES, type Category } from "../../models/constants.js";
import ChartTooltip from "./chartTooltip";

interface StackedBucket {
  period:     string;
  total:      number;
  categories: Record<string, number>;
}

interface Props {
  data:     StackedBucket[];
  currency?: string;
}

const W         = 560;
const BAR_H     = 260;
const PAD       = { top: 20, right: 20, bottom: 40, left: 70 };
const PLOT_W    = W - PAD.left - PAD.right;
const PLOT_H    = BAR_H - PAD.top - PAD.bottom;
const GAP_PCT   = 0.3; // 30% of slot is gap

export default function StackedBarChart({ data, currency = "USD" }: Props) {
  const [tooltip, setTooltip] = useState<{ visible: boolean; x: number; y: number; content: React.ReactNode }>({
    visible: false,
    x: 0,
    y: 0,
    content: null,
  });

  const axisYLabel = `Amount (${currency})`;

  const { bars, yTicks, catKeys } = useMemo(() => {
    if (!data || data.length === 0) return { bars: [], yTicks: [], catKeys: [] };

    const maxTotal = Math.max(...data.map((d) => d.total), 1);
    const allCats  = Array.from(new Set(data.flatMap((d) => Object.keys(d.categories))));
    const slotW    = PLOT_W / data.length;
    const barW     = slotW * (1 - GAP_PCT);

    const bars = data.map((bucket, i) => {
      const x     = PAD.left + i * slotW + (slotW - barW) / 2;
      let   yOff  = PAD.top + PLOT_H; // start from bottom

      const segments = allCats.map((cat) => {
        const val = bucket.categories[cat] ?? 0;
        const h   = (val / maxTotal) * PLOT_H;
        const y   = yOff - h;
        yOff      = y;
        return { cat, val, x, y, w: barW, h };
      }).filter((s) => s.h > 0);

      return { ...bucket, segments, x, barW };
    });

    const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
      y:     PAD.top + (1 - f) * PLOT_H,
      label: fmt(maxTotal * f),
    }));

    return { bars, yTicks, catKeys: allCats };
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
      aria-label={`Stacked bar chart — ${axisYLabel} by period`}
      style={{ width: "100%", overflowX: "auto", position: "relative" }}
    >
      <svg
        viewBox={`0 0 ${W} ${BAR_H + 10}`}
        style={{ width: "100%", maxWidth: `${W}px`, display: "block" }}
        aria-hidden="true"
      >
        {/* Grid lines */}
        {yTicks.map((t, i) => (
          <line key={i} x1={PAD.left} y1={t.y} x2={W - PAD.right} y2={t.y}
            stroke="var(--color-border-dim)" strokeWidth="1" />
        ))}

        {/* Y-axis ticks */}
        {yTicks.map((t, i) => (
          <text key={i} x={PAD.left - 8} y={t.y + 4}
            textAnchor="end" fill="var(--color-text-dim)" fontSize="10">
            {t.label}
          </text>
        ))}

        {/* Bars */}
        {bars.map((bar) => (
          <g key={bar.period}>
            {bar.segments.map((seg, si) => {
              const cat   = CATEGORIES[seg.cat as Category] ?? CATEGORIES.Other;
              const isTop = si === bar.segments.length - 1;
              return (
                <rect
                  key={seg.cat}
                  x={seg.x}
                  y={seg.y}
                  width={seg.w}
                  height={seg.h}
                  fill={cat.color + (si % 2 === 0 ? "ee" : "aa")}
                  rx={isTop ? 4 : 0}
                  style={{ transition: "height 0.6s ease", cursor: "pointer" }}
                  onMouseEnter={(e) => {
                    setTooltip({
                      visible: true,
                      x: e.clientX,
                      y: e.clientY,
                      content: (
                        <div>
                          <div style={{ fontWeight: 600, marginBottom: "2px" }}>{bar.period}</div>
                          <div style={{ opacity: 0.7, fontSize: "10px", marginBottom: "6px" }}>Total: {fmt(bar.total)}</div>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                             <div style={{ width: "8px", height: "8px", borderRadius: "2px", background: cat.color }} />
                             <span>{seg.cat}: <strong>{fmt(seg.val)}</strong></span>
                          </div>
                        </div>
                      )
                    });
                  }}
                  onMouseMove={(e) => {
                    setTooltip(prev => ({ ...prev, x: e.clientX, y: e.clientY }));
                  }}
                  onMouseLeave={() => setTooltip(prev => ({ ...prev, visible: false }))}
                />
              );
            })}

            {/* X-axis label */}
            <text
              x={bar.x + bar.barW / 2}
              y={PAD.top + PLOT_H + 16}
              textAnchor="middle"
              fill="var(--color-text-dim)"
              fontSize="10"
            >
              {bar.period}
            </text>
          </g>
        ))}

        {/* Axes */}
        <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PAD.top + PLOT_H}
          stroke="var(--color-border)" strokeWidth="1" />
        <line x1={PAD.left} y1={PAD.top + PLOT_H} x2={W - PAD.right} y2={PAD.top + PLOT_H}
          stroke="var(--color-border)" strokeWidth="1" />

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
      </svg>

      <ChartTooltip {...tooltip} />

      {/* Category legend */}
      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginTop: "12px" }}>
        {catKeys.map((name) => {
          const cat = CATEGORIES[name as Category] ?? CATEGORIES.Other;
          return (
            <div key={name} style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "11px", color: "var(--color-text-dim)" }}>
              <div style={{ width: "8px", height: "8px", borderRadius: "2px", background: cat.color }} />
              {name}
            </div>
          );
        })}
      </div>
    </div>
  );
}
