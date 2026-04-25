// ─── CostsCrunch — GroupsPage ─────────────────────────────────────────────────
import { useEffect, useMemo, useState } from "react";
import "./groups.css";
import { useExpenseStore, selectExpenses } from "../stores/useExpenseStore";
import { useGroupStore } from "../stores/useGroupStore";
import { groupsApi } from "../services/api";
import { fmt, fmtDate } from "../helpers/utils";
import type { Expense } from "../models/types";
import GroupDetail from "../components/groups/groupDetail";

export function GroupsPage() {
  const expenses = useExpenseStore(selectExpenses);
  const { groups, loading: groupsLoading, fetchGroups } = useGroupStore();

  useEffect(() => { fetchGroups(); }, [fetchGroups]);

  // View State
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"name" | "type" | "totalSpend" | "monthSpend">("name");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

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
      });
      setStatus("success");
      setTimeout(resetForm, 1500);
    } catch (err: any) {
      setStatus("error");
      setErrorMsg(err.message || "Failed to create group");
    }
  };

  // Index expenses by groupId once per expenses change
  const expensesByGroup = useMemo(() => {
    const map: Record<string, Expense[]> = {};
    for (const e of expenses) {
      if (!e.groupId) continue;
      (map[e.groupId] ??= []).push(e);
    }
    return map;
  }, [expenses]);

  // Filtering and Sorting logic
  const filteredAndSortedGroups = useMemo(() => {
    // Filter out potential null/undefined items and start with valid array
    let result = groups.filter(g => !!g);

    // Filter by name - uses safe check for both name and query
    const query = (searchQuery || "").trim().toLowerCase();
    if (query) {
      result = result.filter(g => {
        const name = (g.name || "").toLowerCase();
        return name.includes(query);
      });
    }

    // Sort by attribute
    result.sort((a, b) => {
      // Guard against null objects during sort (redundant but safe)
      if (!a || !b) return 0;

      let valA = a[sortBy] ?? "";
      let valB = b[sortBy] ?? "";

      if (typeof valA === "string") {
        valA = valA.toLowerCase();
        valB = (valB as string).toLowerCase();
      }

      if (valA < valB) return sortOrder === "asc" ? -1 : 1;
      if (valA > valB) return sortOrder === "asc" ? 1 : -1;
      return 0;
    });

    return result;
  }, [groups, searchQuery, sortBy, sortOrder]);

  if (selectedGroupId) {
    return (
      <div className="groups-container">
        <GroupDetail groupId={selectedGroupId} onBack={() => setSelectedGroupId(null)} />
      </div>
    );
  }

  const confirmAllAsReimbursed = async (groupId: string) => {
    if (confirm(`Settle all approved expenses in this group? This will mark them as reimbursed.`)) {
      try { 
        await groupsApi.settle(groupId);
        alert("Balance settled successfully!");
      } catch (err: any) {
        alert("Failed to settle: " + (err.message || err.response?.data?.error || "Unknown error"));
      }
    }
  }

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

      {/* Filter & Sort Controls */}
      <div className="filter-row" style={{ display: "flex", gap: "12px", marginBottom: "20px", flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ flex: 1, minWidth: "200px" }}>
          <input 
            type="text" 
            placeholder="Search groups by name..." 
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{ width: "100%", padding: "10px 14px", borderRadius: "12px", border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-text)", fontSize: "14px" }}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "12px", color: "var(--color-text-dim)", fontWeight: 500 }}>Sort by:</span>
          <select 
            value={sortBy}
            onChange={e => setSortBy(e.target.value as any)}
            style={{ padding: "8px 12px", borderRadius: "10px", border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-text)", fontSize: "14px", cursor: "pointer" }}
          >
            <option value="name">Name</option>
            <option value="type">Type</option>
            <option value="totalSpend">Total Spend</option>
            <option value="monthSpend">Month Spend</option>
          </select>
          <button 
            onClick={() => setSortOrder(prev => prev === "asc" ? "desc" : "asc")}
            style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "10px", padding: "8px 12px", cursor: "pointer", color: "var(--color-text)", fontWeight: 600, fontSize: "14px", minWidth: "40px" }}
            title={sortOrder === "asc" ? "Ascending" : "Descending"}
          >
            {sortOrder === "asc" ? "↑" : "↓"}
          </button>
        </div>
      </div>

      <div className="group-grid">
        {groupsLoading && groups.length === 0 ? (
          <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: "40px", color: "var(--color-text-dim)" }}>Loading groups…</div>
        ) : filteredAndSortedGroups.length === 0 ? (
          <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: "40px", color: "var(--color-text-dim)" }}>No groups found matching "{searchQuery}"</div>
        ) : filteredAndSortedGroups.map((g) => (
          <div key={g.groupId} style={{ background: "var(--color-surface)", border: `1px solid ${g.color}30`, borderRadius: "16px", overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <div style={{ background: `linear-gradient(135deg,${g.color}18,transparent)`, padding: "16px", borderBottom: "1px solid var(--color-border-dim)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "18px" }}>{g.name || (g as any).groupName || "Untitled Group"}</div>
                  <div style={{ fontSize: "11px", color: "var(--color-text-dim)", marginTop: "2px" }}>{g.memberCount ?? 1} members · active</div>
                </div>
                <div style={{ background: (g.color || "#6366f1") + "18", border: `1px solid ${(g.color || "#6366f1")}33`, borderRadius: "6px", padding: "4px 8px", fontSize: "12px", fontWeight: 700, color: g.color || "var(--color-text)" }}>
                  {fmt(g.total ?? g.totalSpend ?? 0)}
                </div>
              </div>
            </div>
            <div style={{ padding: "16px", flex: 1 }}>
              <div style={{ marginBottom: "12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "var(--color-text-dim)", marginBottom: "6px" }}>
                  <span>Your share: <b style={{ color: "var(--color-text)" }}>{fmt(g.myShare || 0)}</b></span>
                  <span>{g.total > 0 ? ((g.myShare / g.total) * 100).toFixed(0) : "0"}%</span>
                </div>
                <div style={{ height: "4px", background: "var(--color-surface-2)", borderRadius: "2px" }}>
                  <div style={{ height: "100%", width: `${g.total > 0 ? ((g.myShare / g.total) * 100).toFixed(0) : "0"}%`, background: `linear-gradient(90deg,${g.color || "#6366f1"},${(g.color || "#6366f1")}88)`, borderRadius: "2px" }} />
                </div>
              </div>
              <div className="recent-expenses-desktop">
                {(expensesByGroup[g.groupId] ?? []).slice(0, 2).map((e) => (
                  <div key={e.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderTop: "1px solid var(--color-surface-2)" }}>
                    <div>
                      <div style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>{e.merchant}</div>
                      <div style={{ fontSize: "10px", color: "var(--color-text-dimmer)" }}>{fmtDate(e.date)}</div>
                    </div>
                    <div style={{ fontSize: "12px", fontWeight: 700 }}>{fmt(e.amount)}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
                <button 
                  onClick={async () => confirmAllAsReimbursed(g.groupId)}
                  style={{ flex: 1, background: "rgba(16, 185, 129, 0.1)", border: "1px solid rgba(16, 185, 129, 0.2)", borderRadius: "8px", padding: "8px", color: "#10b981", fontWeight: 600, fontSize: "12px", cursor: "pointer" }}
                >
                  Settle Balance
                </button>
                <button 
                  onClick={() => setSelectedGroupId(g.groupId)}
                  style={{ flex: 1, background: g.color + "12", border: `1px solid ${g.color}25`, borderRadius: "8px", padding: "8px", color: g.color, fontWeight: 600, fontSize: "12px", cursor: "pointer" }}
                >
                  View Group →
                </button>
              </div>
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
      <div>
      {isModalOpen && (
        <div className="modal-overlay" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, animation: "fadeIn 0.2s ease" }}>
          <div className="modal-content" style={{ background: "var(--color-surface)", width: "100%", maxWidth: "400px", borderRadius: "20px", border: "1px solid var(--color-border)", overflow: "hidden", animation: "fadeUp 0.3s ease" }}>
            <div style={{ padding: "24px", borderBottom: "1px solid var(--color-border-dim)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ margin: 0, fontSize: "18px", fontFamily: "var(--font-display)" }}>New Group</h2>
              <button onClick={resetForm} style={{ background: "none", border: "none", color: "var(--color-text-dim)", cursor: "pointer", fontSize: "20px" }}>&times;</button>
            </div>
            
            <form onSubmit={handleSubmit} style={{ padding: "24px" }}>
              <div style={{ marginBottom: "20px" }}>
                <label style={{ display: "block", fontSize: "12px", color: "var(--color-text-dim)", marginBottom: "8px" }}>Group Name</label>
                <input 
                  autoFocus
                  type="text" 
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g. Summer Trip 2024"
                  style={{ width: "100%", background: "var(--color-surface-2)", border: "1px solid var(--color-border)", borderRadius: "10px", padding: "12px", color: "var(--color-text)", fontSize: "14px" }}
                />
              </div>

              <div style={{ marginBottom: "24px" }}>
                <label style={{ display: "block", fontSize: "12px", color: "var(--color-text-dim)", marginBottom: "8px" }}>Theme Color</label>
                <div style={{ display: "flex", gap: "10px" }}>
                  {["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#0ea5e9"].map(c => (
                    <button 
                      key={c}
                      type="button"
                      onClick={() => setFormData({ ...formData, color: c })}
                      style={{ width: "32px", height: "32px", borderRadius: "50%", background: c, border: formData.color === c ? "2px solid white" : "none", cursor: "pointer", padding: 0 }}
                    />
                  ))}
                </div>
              </div>

              {errorMsg && (
                <div style={{ padding: "12px", background: "rgba(239, 68, 68, 0.1)", border: "1px solid rgba(239, 68, 68, 0.2)", borderRadius: "8px", color: "var(--color-red)", fontSize: "12px", marginBottom: "20px" }}>
                  ⚠️ {errorMsg}
                </div>
              )}

              {status === "success" && (
                <div style={{ padding: "12px", background: "rgba(16, 185, 129, 0.1)", border: "1px solid rgba(16, 185, 129, 0.2)", borderRadius: "8px", color: "var(--color-green)", fontSize: "12px", marginBottom: "20px" }}>
                  ✅ Group created successfully!
                </div>
              )}

              <div style={{ display: "flex", gap: "12px" }}>
                <button 
                  type="button" 
                  onClick={resetForm}
                  style={{ flex: 1, padding: "12px", borderRadius: "10px", border: "1px solid var(--color-border)", background: "transparent", color: "var(--color-text-muted)", fontWeight: 600, cursor: "pointer" }}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  disabled={status === "submitting" || status === "success"}
                  style={{ flex: 2, padding: "12px", borderRadius: "10px", border: "none", background: "var(--color-indigo)", color: "white", fontWeight: 600, cursor: "pointer", opacity: status === "submitting" ? 0.7 : 1 }}
                >
                  {status === "submitting" ? "Creating..." : "Create Group"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
