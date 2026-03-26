import { useMemo } from "react";
import {
  useExpenseStore,
  selectFiltered,
  useFilterControls,
} from "../stores/useExpenseStore";
import { expensesApi } from "../services/api";
import { useState } from "react";
import type { ExpenseFilter } from "../stores/useExpenseStore";
import { fmt } from "../helpers/utils";
import { ExpenseRow } from "../components";

const FILTERS: ExpenseFilter[] = ["all", "pending", "approved", "rejected"];

export function ExpensesPage() {
  const { filter, search, setFilter, setSearch } = useFilterControls();
  const filtered = useExpenseStore(selectFiltered);
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    try {
      setIsExporting(true);
      await expensesApi.export({ 
        format: "csv",
        status: filter !== "all" ? filter : undefined 
      });
    } catch (err) {
      console.error("Export failed:", err);
    }
  };

  const totalFiltered = useMemo(
    () => filtered.reduce((s, e) => s + e.amount, 0),
    [filtered]
  );

  return (
    <div style={{ animation: "fadeUp 0.4s both" }}>
      {/* Page Header */}
      <header className="page-header" style={{ marginBottom: "20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h1 style={{ fontFamily: "var(--font-display)", fontSize: "24px", fontWeight: 700, letterSpacing: "-0.5px", margin: 0 }}>
              All Expenses
            </h1>
            <div style={{ fontSize: "12px", color: "var(--color-text-dim)", marginTop: "4px" }}>
              Manage and track your expenses
            </div>
          </div>
          <button
            onClick={handleExport}
            disabled={isExporting}
            style={{
              padding: "8px 16px",
              borderRadius: "8px",
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              color: "var(--color-text)",
              fontSize: "13px",
              fontWeight: 500,
              cursor: isExporting ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              transition: "all 0.2s",
              opacity: isExporting ? 0.6 : 1,
            }}
          >
            {isExporting ? "⌛ Exporting..." : "📥 Export CSV"}
          </button>
        </div>
        <div style={{ fontSize: "12px", color: "var(--color-text-dim)", marginTop: "4px" }}>
          Manage and track your expenses
        </div>
      </header>

      <div
        style={{
          display: "flex",
          gap: "12px",
          marginBottom: "20px",
          flexWrap: "wrap",
        }}
      >
        <input
          value={search}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setSearch(e.target.value)
          }
          placeholder="🔍  Search expenses..."
          style={{
            flex: 1,
            minWidth: "200px",
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: "10px",
            padding: "10px 16px",
            color: "var(--color-text)",
            fontSize: "14px",
            outline: "none",
          }}
        />

        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: "10px 16px",
              borderRadius: "10px",
              border: "1px solid",
              borderColor: filter === f ? "#6366f1" : "var(--color-border)",
              background:
                filter === f
                  ? "rgba(99,102,241,0.15)"
                  : "var(--color-surface)",
              color: filter === f ? "#818cf8" : "var(--color-text-dim)",
              fontSize: "13px",
              fontWeight: 500,
              cursor: "pointer",
              textTransform: "capitalize",
            }}
          >
            {f}
          </button>
        ))}
      </div>

      <div
        style={{
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: "16px",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--color-border-dim)",
            display: "flex",
            justifyContent: "space-between",
            fontSize: "12px",
            color: "var(--color-text-dim)",
            textTransform: "uppercase",
            letterSpacing: "0.5px",
          }}
        >
          <span>{filtered.length} expenses</span>
          <span>{fmt(totalFiltered)} total</span>
        </div>

        {filtered.map((e, i) => (
          <ExpenseRow key={e.id} expense={e} delay={i * 0.03} />
        ))}

        {filtered.length === 0 && (
          <div
            style={{
              padding: "60px",
              textAlign: "center",
              color: "var(--color-text-dim)",
            }}
          >
            <div style={{ fontSize: "40px", marginBottom: "12px" }}>🔍</div>
            <div>No expenses match your filters</div>
          </div>
        )}
      </div>
    </div>
  );
}
