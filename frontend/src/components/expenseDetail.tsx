import { useState } from "react";
import { CATEGORIES, STATUS_COLORS } from "../models/constants";
import type { Expense, CategoryName } from "../models/types";
import { expensesApi } from "../services/api";
import { fmt, fmtDate } from "../helpers/utils";

interface ExpenseDetailProps {
  expense: Expense;
  onBack: () => void;
  onUpdate: (updated: Expense) => void;
}

export default function ExpenseDetail({ expense, onBack, onUpdate }: ExpenseDetailProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState({
    merchant: expense.merchant,
    amount: expense.amount,
    category: expense.category,
    date: expense.date,
    description: expense.description || "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPending = expense.status === "pending" || expense.status === "draft";

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isPending) return;

    setSubmitting(true);
    setError(null);
    try {
      // Explicitly cast to CategoryName to satisfy strict API interface
      const updatePayload = {
        ...form,
        category: form.category as CategoryName
      };
      const updated = await expensesApi.update(expense.id, updatePayload);
 
      onUpdate(updated);
      setIsEditing(false);
    } catch (err: any) {
      setError(err.message || "Failed to update expense");
    } finally {
      setSubmitting(false);
    }
  };

  const cat = (CATEGORIES as any)[expense.category] || CATEGORIES.Other;

  return (
    <div style={{ animation: "fadeUp 0.4s both" }}>
      <button
        onClick={onBack}
        style={{
          background: "none",
          border: "none",
          color: "var(--color-indigo)",
          cursor: "pointer",
          fontWeight: 600,
          marginBottom: "20px",
          padding: 0,
          display: "flex",
          alignItems: "center",
          gap: "4px"
        }}
      >
        ← Back to list
      </button>

      <div style={{ 
        background: "var(--color-surface)", 
        padding: "32px", 
        borderRadius: "24px", 
        border: "1px solid var(--color-border-dim)",
        boxShadow: "0 10px 30px rgba(0,0,0,0.1)"
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "32px" }}>
          <div style={{ display: "flex", gap: "20px", alignItems: "center" }}>
            <div style={{
              width: "60px", height: "60px",
              borderRadius: "15px",
              background: cat.color + "18",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "28px"
            }}>
              {cat.icon}
            </div>
            <div>
              <h2 style={{ fontSize: "24px", fontWeight: 700, margin: 0 }}>{expense.merchant}</h2>
              <div style={{ color: "var(--color-text-dim)", fontSize: "14px", marginTop: "4px" }}>
                Added on {fmtDate(expense.date)}
              </div>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "24px", fontWeight: 800, color: "var(--color-text)" }}>{fmt(expense.amount)}</div>
            <div style={{ 
              fontSize: "12px", 
              fontWeight: 700, 
              color: STATUS_COLORS[expense.status] || "var(--color-text-dim)",
              textTransform: "uppercase",
              letterSpacing: "1px",
              marginTop: "4px"
            }}>
              {expense.status}
            </div>
          </div>
        </div>

        <form onSubmit={handleUpdate} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
          <div style={{ gridColumn: "1 / -1" }}>
            <label htmlFor="description" style={{ display: "block", fontSize: "12px", color: "var(--color-text-dim)", marginBottom: "8px", fontWeight: 600 }}>
              Description
            </label>
            <textarea
              id="description"
              value={form.description}
              disabled={!isPending}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              style={{
                width: "100%", padding: "12px", borderRadius: "12px",
                background: "var(--color-surface-dim)", border: "1px solid var(--color-border)",
                color: "var(--color-text)", minHeight: "100px", resize: "none",
                outline: "none", opacity: isPending ? 1 : 0.6
              }}
            />
          </div>

          <div>
            <label htmlFor="category" style={{ display: "block", fontSize: "12px", color: "var(--color-text-dim)", marginBottom: "8px", fontWeight: 600 }}>
              Category
            </label>
            <select
              id="category"
              value={form.category}
              disabled={!isPending}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              style={{
                width: "100%", padding: "12px", borderRadius: "12px",
                background: "var(--color-surface-dim)", border: "1px solid var(--color-border)",
                color: "var(--color-text)", outline: "none", opacity: isPending ? 1 : 0.6
              }}
            >
              {Object.keys(CATEGORIES).map(k => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="date" style={{ display: "block", fontSize: "12px", color: "var(--color-text-dim)", marginBottom: "8px", fontWeight: 600 }}>
              Date
            </label>
            <input
              id="date"
              type="date"
              value={form.date}
              disabled={!isPending}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              style={{
                width: "100%", padding: "12px", borderRadius: "12px",
                background: "var(--color-surface-dim)", border: "1px solid var(--color-border)",
                color: "var(--color-text)", outline: "none", opacity: isPending ? 1 : 0.6
              }}
            />
          </div>

          {error && (
            <div style={{ gridColumn: "1 / -1", color: "var(--color-error)", fontSize: "14px" }}>
              ⚠️ {error}
            </div>
          )}

          {isPending && (
            <div style={{ gridColumn: "1 / -1", marginTop: "12px", display: "flex", gap: "12px" }}>
              <button
                type="submit"
                disabled={submitting}
                style={{
                  flex: 1, padding: "14px", borderRadius: "12px", border: "none",
                  background: "var(--color-indigo)", color: "white", fontWeight: 700,
                  cursor: submitting ? "not-allowed" : "pointer", opacity: submitting ? 0.7 : 1
                }}
              >
                {submitting ? "Saving..." : "Save Changes"}
              </button>
            </div>
          )}
        </form>

        {!isPending && (
          <div style={{ 
            marginTop: "32px", padding: "16px", borderRadius: "12px", 
            background: "rgba(99, 102, 241, 0.05)", border: "1px dashed var(--color-indigo)",
            color: "var(--color-text-dim)", fontSize: "13px", textAlign: "center"
          }}>
            This expense is already <strong>{expense.status}</strong> and cannot be edited.
          </div>
        )}
      </div>
    </div>
  );
}
