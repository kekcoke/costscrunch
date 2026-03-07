// ─── CostsCrunch — GroupsPage ─────────────────────────────────────────────────
import { useMemo } from "react";
import { useExpenseStore, selectExpenses } from "../stores/useExpenseStore";
import { MOCK_GROUPS } from "../mocks/groups";
import { fmt, fmtDate } from "../helpers/utils";
import type { Expense } from "../models/types";

export function GroupsPage() {
  const expenses = useExpenseStore(selectExpenses);

  // Index expenses by groupId once per expenses change rather than re-filtering
  // inside every group's render pass.
  const expensesByGroup = useMemo(() => {
    const map: Record<string, Expense[]> = {};
    for (const e of expenses) {
      if (!e.groupId) continue;
      (map[e.groupId] ??= []).push(e);
    }
    return map;
  }, [expenses]);

  return (
    <div style={{ animation: "fadeUp 0.4s both" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))", gap: "20px" }}>
        {MOCK_GROUPS.map((g) => (
          <div key={g.id} style={{ background: "var(--color-surface)", border: `1px solid ${g.color}30`, borderRadius: "18px", overflow: "hidden" }}>
            <div style={{ background: `linear-gradient(135deg,${g.color}18,transparent)`, padding: "24px", borderBottom: "1px solid var(--color-border-dim)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "20px" }}>{g.name}</div>
                  <div style={{ fontSize: "12px", color: "var(--color-text-dim)", marginTop: "4px" }}>{g.members} members · active</div>
                </div>
                <div style={{ background: g.color + "22", border: `1px solid ${g.color}44`, borderRadius: "8px", padding: "6px 12px", fontSize: "13px", fontWeight: 700, color: g.color }}>
                  {fmt(g.total)}
                </div>
              </div>
            </div>
            <div style={{ padding: "20px" }}>
              <div style={{ marginBottom: "16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "var(--color-text-dim)", marginBottom: "8px" }}>
                  <span>Your share</span>
                  <span style={{ color: "var(--color-text)", fontWeight: 700 }}>{fmt(g.myShare)}</span>
                </div>
                <div style={{ height: "6px", background: "var(--color-surface-2)", borderRadius: "3px" }}>
                  <div style={{ height: "100%", width: `${((g.myShare / g.total) * 100).toFixed(0)}%`, background: `linear-gradient(90deg,${g.color},${g.color}88)`, borderRadius: "3px" }} />
                </div>
                <div style={{ fontSize: "11px", color: "var(--color-text-dimmer)", marginTop: "5px" }}>
                  {((g.myShare / g.total) * 100).toFixed(0)}% of group total
                </div>
              </div>
              {(expensesByGroup[g.id] ?? []).slice(0, 3).map((e) => (
                <div key={e.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderTop: "1px solid var(--color-surface-2)" }}>
                  <div>
                    <div style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>{e.merchant}</div>
                    <div style={{ fontSize: "11px", color: "var(--color-text-dimmer)" }}>{e.addedBy} · {fmtDate(e.date)}</div>
                  </div>
                  <div style={{ fontSize: "13px", fontWeight: 700 }}>{fmt(e.amount)}</div>
                </div>
              ))}
              <button style={{ width: "100%", marginTop: "14px", background: g.color + "18", border: `1px solid ${g.color}33`, borderRadius: "9px", padding: "10px", color: g.color, fontWeight: 600, fontSize: "13px", cursor: "pointer" }}>
                View All Group Expenses →
              </button>
            </div>
          </div>
        ))}

        <div
          role="button"
          tabIndex={0}
          style={{ border: "2px dashed var(--color-border)", borderRadius: "18px", padding: "40px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "12px", cursor: "pointer", color: "var(--color-text-dimmer)" }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = "#6366f1"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = "var(--color-border)"; }}
        >
          <div style={{ fontSize: "32px" }}>+</div>
          <div style={{ fontWeight: 600, fontSize: "14px" }}>Create New Group</div>
          <div style={{ fontSize: "12px", textAlign: "center" }}>Split expenses with team members, family, or friends</div>
        </div>
      </div>
    </div>
  );
}