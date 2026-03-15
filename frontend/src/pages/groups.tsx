// ─── CostsCrunch — GroupsPage ─────────────────────────────────────────────────
import { useMemo, useState } from "react";
import "./groups.css";
import { useExpenseStore, selectExpenses } from "../stores/useExpenseStore";
import { groupsApi } from "../services/api";
import { MOCK_GROUPS } from "../mocks/groups";
import { fmt, fmtDate } from "../helpers/utils";
import type { Expense } from "../models/types";

export function GroupsPage() {
  const expenses = useExpenseStore(selectExpenses);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({ name: "", color: "#6366f1" });
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const resetForm = () => {
    setFormData({ name: "", color: "#6366f1" });
    setStatus("idle");
    setErrorMsg("");
    setIsModalOpen(false);
  };

  const handleSubmit = async (e: React.SubmitEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) return setErrorMsg("Group name is required");

    setStatus("submitting");
    setErrorMsg("");

    try {
      await groupsApi.create({
        name: formData.name,
        color: formData.color,
        members: [], // Default to creator
        memberCount: 1
      });
      setStatus("success");
      setTimeout(resetForm, 1500);
    } catch (err: any) {
      setStatus("error");
      setErrorMsg(err.message || "Failed to create group");
    }
  };

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
    <div className="groups-container">
      {/* Page Header */}
      <header className="page-header" style={{ marginBottom: "20px" }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: "24px", fontWeight: 700, letterSpacing: "-0.5px", margin: 0 }}>
          Groups & Splits
        </h1>
        <div style={{ fontSize: "12px", color: "var(--color-text-dim)", marginTop: "4px" }}>
          Shared budgets and expense splitting
        </div>
      </header>

      <div className="group-grid">
        {MOCK_GROUPS.map((g) => (
          <div key={g.id} style={{ background: "var(--color-surface)", border: `1px solid ${g.color}30`, borderRadius: "16px", overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <div style={{ background: `linear-gradient(135deg,${g.color}18,transparent)`, padding: "16px", borderBottom: "1px solid var(--color-border-dim)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "18px" }}>{g.name}</div>
                  <div style={{ fontSize: "11px", color: "var(--color-text-dim)", marginTop: "2px" }}>{g.members} members · active</div>
                </div>
                <div style={{ background: g.color + "18", border: `1px solid ${g.color}33`, borderRadius: "6px", padding: "4px 8px", fontSize: "12px", fontWeight: 700, color: g.color }}>
                  {fmt(g.total)}
                </div>
              </div>
            </div>
            <div style={{ padding: "16px", flex: 1 }}>
              <div style={{ marginBottom: "12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "var(--color-text-dim)", marginBottom: "6px" }}>
                  <span>Your share: <b style={{ color: "var(--color-text)" }}>{fmt(g.myShare)}</b></span>
                  <span>{((g.myShare / g.total) * 100).toFixed(0)}%</span>
                </div>
                <div style={{ height: "4px", background: "var(--color-surface-2)", borderRadius: "2px" }}>
                  <div style={{ height: "100%", width: `${((g.myShare / g.total) * 100).toFixed(0)}%`, background: `linear-gradient(90deg,${g.color},${g.color}88)`, borderRadius: "2px" }} />
                </div>
              </div>
              <div className="recent-expenses-desktop">
                {(expensesByGroup[g.id] ?? []).slice(0, 2).map((e) => (
                  <div key={e.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderTop: "1px solid var(--color-surface-2)" }}>
                    <div>
                      <div style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>{e.merchant}</div>
                      <div style={{ fontSize: "10px", color: "var(--color-text-dimmer)" }}>{fmtDate(e.date)}</div>
                    </div>
                    <div style={{ fontSize: "12px", fontWeight: 700 }}>{fmt(e.amount)}</div>
                  </div>
                ))}
              </div>
              <button style={{ width: "100%", marginTop: "12px", background: g.color + "12", border: `1px solid ${g.color}25`, borderRadius: "8px", padding: "8px", color: g.color, fontWeight: 600, fontSize: "12px", cursor: "pointer" }}>
                View Group →
              </button>
            </div>
          </div>
        ))}

        <div
          role="button"
          tabIndex={0}
          onClick={() => setIsModalOpen(true)}
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
