import { useMemo } from "react";
import { useExpenseStore } from "../stores/useExpenseStore";
import { fmt } from "../helpers/utils";
import { ExpenseRow } from "../components";

const FILTERS = ["all", "pending", "approved", "rejected"] as const;

export function ExpensesPage() {
  const filter = useExpenseStore((s) => s.filter);
  const search = useExpenseStore((s) => s.search);
  const filtered = useExpenseStore((s) => s.filtered);
  const setFilter = useExpenseStore((s) => s.setFilter);
  const setSearch = useExpenseStore((s) => s.setSearch);

  const totalFiltered = useMemo(
    () => filtered.reduce((s, e) => s + e.amount, 0),
    [filtered]
  );

  return (
    <div style={{ animation: "fadeUp 0.4s both" }}>
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