// ─── CostsCrunch — DashboardPage ─────────────────────────────────────────────
import { useEffect, useMemo } from "react";
import {
  useExpenseStore,
  selectExpenses,
  selectPending,
  selectMyExpenses,
} from "../stores/useExpenseStore";
import { useGroupStore } from "../stores/useGroupStore";
import { CATEGORIES } from "../models/constants";
import { fmt } from "../helpers/utils";
import { StatCard, ExpenseRow, DonutChart } from "../components";

export function DashboardPage() {
  const expenses   = useExpenseStore(selectExpenses);
  const pending    = useExpenseStore(selectPending);
  const myExpenses = useExpenseStore(selectMyExpenses);
  const { groups, fetchGroups } = useGroupStore();

  useEffect(() => { fetchGroups(); }, [fetchGroups]);

  const totalMonth = useMemo(() => expenses.reduce((s, e) => s + e.amount, 0), [expenses]);
  const myTotal    = useMemo(() => myExpenses.reduce((s, e) => s + e.amount, 0), [myExpenses]);
  const pendingAmt = useMemo(() => pending.reduce((s, e) => s + e.amount, 0), [pending]);

  const catData = useMemo(() => {
    const map: Record<string, number> = {};
    for (const e of expenses) map[e.category] = (map[e.category] ?? 0) + e.amount;
    return Object.entries(map)
      .map(([label, value]) => ({ label, value, color: CATEGORIES[label as keyof typeof CATEGORIES]?.color ?? "#64748b" }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }, [expenses]);

  return (
    <div>
      {/* Page Header */}
      <header className="page-header" style={{ marginBottom: "24px" }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: "24px", fontWeight: 700, letterSpacing: "-0.5px", margin: 0 }}>
          Overview
        </h1>
        <div style={{ fontSize: "12px", color: "var(--color-text-dim)", marginTop: "4px" }}>
          February 2026
        </div>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "var(--grid-cols-4, repeat(4, 1fr))", gap: "16px", marginBottom: "28px" }}>
        <StatCard label="Month Total"    value={fmt(totalMonth)}          sub="↑ 12% vs last month"                  delay={0} />
        <StatCard label="My Expenses"    value={fmt(myTotal)}             sub={`${myExpenses.length} transactions`}  accent="#0ea5e9" delay={0.05} />
        <StatCard label="Pending Review" value={String(pending.length)}   sub={`${fmt(pendingAmt)} to approve`}      accent="#f59e0b" delay={0.1} />
        <StatCard label="Active Groups"  value={String(groups.length)} sub={`${groups.length} shared budgets`}          accent="#10b981" delay={0.15} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "var(--grid-cols-dashboard, 1fr 360px)", gap: "20px", marginBottom: "28px" }}>
        <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "16px", overflow: "hidden", animation: "fadeUp 0.5s 0.2s both" }}>
          <div style={{ padding: "20px 20px 0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "15px" }}>Recent Expenses</div>
          </div>
          {expenses.slice(0, 5).map((e, i) => (
            <ExpenseRow key={e.id} expense={e} delay={0.25 + i * 0.05} />
          ))}
        </div>

        <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "16px", padding: "24px", animation: "fadeUp 0.5s 0.2s both" }}>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "15px", marginBottom: "20px" }}>By Category</div>
          <DonutChart data={catData} />
        </div>
      </div>

      <div style={{ animation: "fadeUp 0.5s 0.3s both" }}>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "15px", marginBottom: "16px" }}>Group Budgets</div>
        <div style={{ display: "grid", gridTemplateColumns: "var(--grid-cols-3, repeat(3, 1fr))", gap: "16px" }}>
          {groups.map((g) => (
            <div key={g.id} style={{ background: "var(--color-surface)", border: `1px solid ${g.color}22`, borderRadius: "14px", padding: "20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
                <div style={{ width: "10px", height: "10px", borderRadius: "3px", background: g.color }} />
                <span style={{ fontWeight: 700, fontSize: "15px" }}>{g.name}</span>
                <span style={{ marginLeft: "auto", fontSize: "12px", color: "var(--color-text-dim)" }}>{g.members} members</span>
              </div>
              <div style={{ fontSize: "22px", fontWeight: 800, color: g.color, fontFamily: "var(--font-display)", letterSpacing: "-0.5px" }}>{fmt(g.total)}</div>
              <div style={{ fontSize: "12px", color: "var(--color-text-dim)", marginTop: "4px" }}>Your share: {fmt(g.myShare)}</div>
              <div style={{ marginTop: "12px", height: "4px", background: "var(--color-surface-2)", borderRadius: "2px" }}>
                <div style={{ height: "100%", width: `${((g.myShare / g.total) * 100).toFixed(0)}%`, background: g.color, borderRadius: "2px" }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
