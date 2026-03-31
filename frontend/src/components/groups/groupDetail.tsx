import { useState, useEffect } from "react";
import type { Group, GroupMember } from "../../models/types";
import { groupsApi } from "../../services/api";
import { useGroupStore } from "../../stores/useGroupStore";
import { LoadingSpinner } from "../spinner";
import Modal from "../modal";

// ─── Group Detail Component ──────────────────────────────────────────────────
export default function GroupDetail({ groupId, onBack }: { groupId: string, onBack: () => void }) {
  const { updateGroup: updateStoreGroup, deleteGroup: deleteStoreGroup } = useGroupStore();
  const [group, setGroup] = useState<Group | null>(null);
  const [balances, setBalances] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  
  // View State
  const [isEditing, setIsEditing] = useState(false);

  // UI State for CRUD
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isDeleteGroupModalOpen, setIsDeleteGroupModalOpen] = useState(false);
  const [selectedMember, setSelectedMember] = useState<GroupMember | null>(null);
  
  // Form States
  const [addForm, setAddForm] = useState({ name: "", email: "" });
  const [editForm, setEditForm] = useState({ name: "", description: "", color: "" });
  const [status, setStatus] = useState<{ type: "success" | "error" | "warn", msg: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const fetchGroup = () => {
    Promise.all([
      groupsApi.get(groupId),
      groupsApi.getBalances(groupId)
    ]).then(([groupData, balanceData]) => {
      setGroup(groupData);
      setBalances(balanceData);
      setEditForm({
        name: groupData.name,
        description: groupData.description || "",
        color: groupData.color,
      });
    }).finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchGroup();
  }, [groupId]);

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addForm.email) return setStatus({ type: "error", msg: "Email is required" });
    
    setSubmitting(true);
    try {
      await groupsApi.addMember(groupId, addForm);
      setStatus({ type: "success", msg: "Member added successfully!" });
      setTimeout(() => {
        setIsAddModalOpen(false);
        setAddForm({ name: "", email: "" });
        setStatus(null);
        fetchGroup();
      }, 1500);
    } catch (err : any) {
      setStatus({ type: "error", msg: "Failed to add member. Please try again." });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteMember = async () => {
    const memberId = selectedMember?.userId;
    if (!memberId) return;

    setSubmitting(true);
    try {
      await groupsApi.deleteMember(groupId, memberId);
      setStatus({ type: "success", msg: "Member removed." });
      setTimeout(() => {
        setIsDeleteModalOpen(false);
        setSelectedMember(null);
        setStatus(null);
        fetchGroup();
      }, 1500);
    } catch (err: any) {
      setStatus({ type: "error", msg: "Failed to remove member." });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteGroup = async (groupId: string) => {
    setSubmitting(true);
    setStatus(null);
    try {
      await groupsApi.delete(groupId);
      setStatus({ type: "success", msg: "Group deleted successfully. Redirecting..." });
      deleteStoreGroup(groupId);
      setTimeout(() => {
        onBack(); // Go back to groups list
      }, 2000);
    } catch (err: any) {
      setStatus({ type: "error", msg: err.message || "Failed to delete group" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSettle = async () => {
    if (!confirm("Are you sure? This will mark all currently approved expenses as settled/reimbursed.")) return;
    setSubmitting(true);
    try {
      await groupsApi.settle(groupId);
      setStatus({ type: "success", msg: "Group settled successfully!" });
      fetchGroup();
    } catch (err: any) {
      setStatus({ type: "error", msg: err.message || "Settlement failed" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setStatus(null);
    try {
      const updated = await groupsApi.update(groupId, editForm);
      updateStoreGroup(groupId, updated);
      setStatus({ type: "success", msg: "Group updated successfully!" });
      setTimeout(() => {
        setIsEditing(false);
        setStatus(null);
        fetchGroup();
      }, 1500);
    } catch (err: any) {
      setStatus({ type: "error", msg: err.message || "Update failed" });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <LoadingSpinner size="40px" />;
  if (!group) return <div>Group not found.</div>;

  const members = group.members || [];

  if (isEditing) {
    return (
      <div style={{ animation: "fadeUp 0.4s both" }}>
        <button 
          onClick={() => { setIsEditing(false); setStatus(null); }} 
          style={{ background: "none", border: "none", color: "var(--color-indigo)", cursor: "pointer", fontWeight: 600, marginBottom: "20px", padding: 0 }}
        >
          ← Back to Group Detail
        </button>

        <div style={{ background: "var(--color-surface)", padding: "24px", borderRadius: "20px", border: "1px solid var(--color-border-dim)" }}>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "24px", marginBottom: "24px" }}>Update Group Settings</h2>
          
          <form onSubmit={handleUpdateGroup} style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <div>
              <label style={{ display: "block", fontSize: "12px", color: "var(--color-text-dim)", marginBottom: "8px" }}>Group Name</label>
              <input 
                type="text" 
                value={editForm.name} 
                onChange={e => setEditForm({...editForm, name: e.target.value})}
                style={{ width: "100%", padding: "12px", borderRadius: "10px", border: "1px solid var(--color-border)", background: "var(--color-surface-2)", color: "white" }}
              />
            </div>

            <div>
              <label style={{ display: "block", fontSize: "12px", color: "var(--color-text-dim)", marginBottom: "8px" }}>Description</label>
              <textarea 
                value={editForm.description} 
                onChange={e => setEditForm({...editForm, description: e.target.value})}
                style={{ width: "100%", padding: "12px", borderRadius: "10px", border: "1px solid var(--color-border)", background: "var(--color-surface-2)", color: "white", minHeight: "80px", resize: "vertical" }}
              />
            </div>

            <div>
              <label style={{ display: "block", fontSize: "12px", color: "var(--color-text-dim)", marginBottom: "8px" }}>Theme Color</label>
              <div style={{ display: "flex", gap: "10px" }}>
                {["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#0ea5e9"].map(c => (
                  <button 
                    key={c}
                    type="button"
                    onClick={() => setEditForm({ ...editForm, color: c })}
                    style={{ width: "32px", height: "32px", borderRadius: "50%", background: c, border: editForm.color === c ? "2px solid white" : "none", cursor: "pointer", padding: 0 }}
                  />
                ))}
              </div>
            </div>

            {status && (
              <div style={{ 
                padding: "12px", borderRadius: "10px", fontSize: "14px", fontWeight: 500,
                background: status.type === "success" ? "rgba(16, 185, 129, 0.15)" : status.type === "warn" ? "rgba(245, 158, 11, 0.15)" : "rgba(239, 68, 68, 0.15)",
                color: status.type === "success" ? "#10b981" : status.type === "warn" ? "#f59e0b" : "#ef4444",
                border: `1px solid ${status.type === "success" ? "#10b98133" : status.type === "warn" ? "#f59e0b33" : "#ef444433"}`
              }}>
                {status.type === "success" ? "✅ " : status.type === "warn" ? "⚠️ " : "❌ "}
                {status.msg}
              </div>
            )}

            <div style={{ display: "flex", gap: "12px", marginTop: "10px" }}>
              <button 
                type="button" 
                onClick={() => setIsEditing(false)}
                style={{ flex: 1, padding: "14px", borderRadius: "12px", border: "1px solid var(--color-border)", background: "transparent", color: "white", fontWeight: 600, cursor: "pointer" }}
              >
                Cancel
              </button>
              <button 
                type="submit" 
                disabled={submitting}
                style={{ flex: 2, padding: "14px", borderRadius: "12px", border: "none", background: "var(--color-indigo)", color: "white", fontWeight: 700, cursor: submitting ? "not-allowed" : "pointer", opacity: submitting ? 0.7 : 1 }}
              >
                {submitting ? "Saving..." : "Submit Changes"}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div style={{ animation: "fadeUp 0.4s both" }}>
      <button onClick={onBack} style={{ background: "none", border: "none", color: "var(--color-indigo)", cursor: "pointer", fontWeight: 600, marginBottom: "20px", padding: 0 }}>
        ← Back to Groups
      </button>
      
      {/* Row 1: Header Info */}
      <div style={{ background: "var(--color-surface)", padding: "24px", borderRadius: "18px", border: `1px solid ${group.color}33`, marginBottom: "20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "28px", margin: 0 }}>{group.name}</h2>
          <div style={{ color: "var(--color-text-dim)", marginTop: "4px" }}>{group.memberCount} Members Total</div>
        </div>
        
        <div style={{ display: "flex", gap: "10px" }}>
          <button 
            onClick={handleSettle}
            disabled={submitting}
            style={{ 
              background: "rgba(16, 185, 129, 0.1)", color: "#10b981", border: "1px solid rgba(16, 185, 129, 0.2)", 
              padding: "10px 18px", borderRadius: "10px", fontWeight: 600, cursor: "pointer"
            }}
          >
            Settle Balances
          </button>
          <button 
            onClick={() => setIsEditing(true)}
            style={{ 
              background: "var(--color-surface-2)", color: "var(--color-text-dim)", border: "1px solid var(--color-border)", 
              padding: "10px 18px", borderRadius: "10px", fontWeight: 600, cursor: "pointer"
            }}
          >
            Update Group
          </button>
          <button 
            onClick={() => setIsAddModalOpen(true)}
            style={{ 
              background: "var(--color-indigo)", color: "white", border: "none", 
              padding: "10px 18px", borderRadius: "10px", fontWeight: 600, cursor: "pointer",
              display: "flex", alignItems: "center", gap: "8px"
            }}
          >
            <span className="mobile-hide">+ Add Member</span>
            <span className="mobile-only">+</span>
          </button>
          <button 
            onClick={() => setIsDeleteGroupModalOpen(true)}
            style={{ 
              background: "rgba(239, 68, 68, 0.1)", color: "#ef4444", border: "1px solid rgba(239, 68, 68, 0.2)", 
              padding: "10px 18px", borderRadius: "10px", fontWeight: 600, cursor: "pointer"
            }}
          >
            Delete
          </button>
        </div>
      </div>

      {/* Row 2: Balances & Settlements */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginBottom: "20px" }}>
        <div style={{ background: "var(--color-surface)", padding: "24px", borderRadius: "18px", border: "1px solid var(--color-border-dim)" }}>
          <h3 style={{ fontSize: "15px", fontWeight: 700, marginBottom: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
            <span>📊</span> Current Balances
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {members.map(m => {
              const bal = balances?.balances?.[m.userId] || 0;
              return (
                <div key={m.userId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>{m.name}</span>
                  <span style={{ 
                    fontSize: "14px", 
                    fontWeight: 700, 
                    color: bal > 0.01 ? "#10b981" : bal < -0.01 ? "#ef4444" : "var(--color-text-dim)" 
                  }}>
                    {bal > 0 ? "+" : ""}{bal.toFixed(2)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ background: "var(--color-surface)", padding: "24px", borderRadius: "18px", border: "1px solid var(--color-border-dim)" }}>
          <h3 style={{ fontSize: "15px", fontWeight: 700, marginBottom: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
            <span>🤝</span> Settlement Plan
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {balances?.settlements?.length === 0 ? (
              <div style={{ fontSize: "13px", color: "var(--color-text-dim)", fontStyle: "italic" }}>All settled!</div>
            ) : balances?.settlements?.map((s: any, i: number) => {
              const fromName = members.find(m => m.userId === s.from)?.name || "Unknown";
              const toName = members.find(m => m.userId === s.to)?.name || "Unknown";
              return (
                <div key={i} style={{ fontSize: "13px", background: "var(--color-surface-2)", padding: "10px", borderRadius: "8px" }}>
                  <strong>{fromName}</strong> pays <strong>{toName}</strong> <span style={{ color: "#38bdf8", fontWeight: 700 }}>${s.amount.toFixed(2)}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Row 3: Members List */}
      <div style={{ background: "var(--color-surface)", padding: "24px", borderRadius: "18px", border: "1px solid var(--color-border-dim)" }}>
        <h3 style={{ fontSize: "16px", marginBottom: "16px" }}>Group Members</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {members.map(m => (
            <div key={m.userId} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "12px", background: "var(--color-surface-2)", borderRadius: "12px" }}>
              <div style={{ width: "36px", height: "36px", borderRadius: "50%", background: "var(--color-indigo)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", fontWeight: 700, color: "white" }}>
                {m.name.charAt(0).toUpperCase()}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{m.name}</div>
                <div style={{ fontSize: "11px", color: "var(--color-text-dim)" }}>{m.role.charAt(0).toUpperCase() + m.role.slice(1)}</div>
              </div>
              {m.role.toLowerCase() !== "owner" && (
                <button 
                  onClick={() => { setSelectedMember(m); setIsDeleteModalOpen(true); }}
                  style={{ background: "rgba(239, 68, 68, 0.1)", color: "#ef4444", border: "none", padding: "8px", borderRadius: "8px", cursor: "pointer" }}
                >
                  <span className="mobile-hide">Remove</span>
                  <span className="mobile-only">🗑️</span>
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Add Member Modal */}
      <Modal 
        isOpen={isAddModalOpen} 
        onClose={() => { setIsAddModalOpen(false); setStatus(null); }}
        title="Add Group Member"
        subtitle="Invite a new member to this expense group"
      >
        <form onSubmit={handleAddMember} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div>
            <label style={{ display: "block", fontSize: "12px", color: "var(--color-text-dim)", marginBottom: "6px" }}>Full Name</label>
            <input 
              type="text" 
              value={addForm.name} 
              onChange={e => setAddForm({...addForm, name: e.target.value})}
              placeholder="e.g. John Doe"
              style={{ width: "100%", padding: "12px", borderRadius: "8px", border: "1px solid var(--color-border)", background: "var(--color-surface-2)", color: "white" }}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "12px", color: "var(--color-text-dim)", marginBottom: "6px" }}>Email Address</label>
            <input 
              type="email" 
              required
              value={addForm.email} 
              onChange={e => setAddForm({...addForm, email: e.target.value})}
              placeholder="john@example.com"
              style={{ width: "100%", padding: "12px", borderRadius: "8px", border: "1px solid var(--color-border)", background: "var(--color-surface-2)", color: "white" }}
            />
          </div>

          {status && (
            <div style={{ 
              padding: "10px", borderRadius: "8px", fontSize: "13px",
              background: status.type === "success" ? "rgba(16, 185, 129, 0.1)" : "rgba(239, 68, 68, 0.1)",
              color: status.type === "success" ? "#10b981" : "#ef4444"
            }}>
              {status.msg}
            </div>
          )}

          <div style={{ display: "flex", gap: "12px", marginTop: "8px" }}>
            <button 
              type="button" 
              onClick={() => setIsAddModalOpen(false)}
              style={{ flex: 1, padding: "12px", borderRadius: "10px", border: "1px solid var(--color-border)", background: "transparent", color: "white", cursor: "pointer" }}
            >
              Cancel
            </button>
            <button 
              type="submit" 
              disabled={submitting}
              style={{ flex: 1, padding: "12px", borderRadius: "10px", border: "none", background: "var(--color-indigo)", color: "white", fontWeight: 600, cursor: submitting ? "not-allowed" : "pointer", opacity: submitting ? 0.7 : 1 }}
            >
              {submitting ? "Adding..." : "Add Member"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Member Modal */}
      <Modal
        isOpen={isDeleteModalOpen}
        onClose={() => { setIsDeleteModalOpen(false); setStatus(null); }}
        title="Remove Member"
        maxWidth="400px"
      >
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "40px", marginBottom: "16px" }}>⚠️</div>
          <p style={{ margin: "0 0 24px", color: "var(--color-text-dim)" }}>
            Are you sure you want to remove <strong>{selectedMember?.name}</strong> from this group? 
            They will lose access to shared expenses.
          </p>

          {status && (
            <div style={{ padding: "10px", borderRadius: "8px", marginBottom: "16px", background: "rgba(239, 68, 68, 0.1)", color: "#ef4444" }}>
              {status.msg}
            </div>
          )}

          <div style={{ display: "flex", gap: "12px" }}>
            <button 
              onClick={() => setIsDeleteModalOpen(false)}
              style={{ flex: 1, padding: "12px", borderRadius: "10px", border: "1px solid var(--color-border)", background: "transparent", color: "white", cursor: "pointer" }}
            >
              Cancel
            </button>
            <button 
              onClick={handleDeleteMember}
              disabled={submitting}
              style={{ flex: 1, padding: "12px", borderRadius: "10px", border: "none", background: "#ef4444", color: "white", fontWeight: 600, cursor: submitting ? "not-allowed" : "pointer" }}
            >
              {submitting ? "Removing..." : "Confirm Remove"}
            </button>
          </div>
        </div>
      </Modal>

      {/* Delete Group Modal */}
      <Modal
        isOpen={isDeleteGroupModalOpen}
        onClose={() => { setIsDeleteGroupModalOpen(false); setStatus(null); }}
        title="Delete Group"
        maxWidth="400px"
      >
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "40px", marginBottom: "16px" }}>🔥</div>
          <p style={{ margin: "0 0 24px", color: "var(--color-text-dim)" }}>
            Are you sure you want to delete <strong>{group.name}</strong>? 
            This action is permanent and will remove all associated expenses and data.
          </p>

          {status && (
            <div style={{ 
              padding: "10px", borderRadius: "8px", marginBottom: "16px", 
              background: status.type === "success" ? "rgba(16, 185, 129, 0.1)" : "rgba(239, 68, 68, 0.1)", 
              color: status.type === "success" ? "#10b981" : "#ef4444" 
            }}>
              {status.msg}
            </div>
          )}

          <div style={{ display: "flex", gap: "12px" }}>
            <button 
              onClick={() => setIsDeleteGroupModalOpen(false)}
              style={{ flex: 1, padding: "12px", borderRadius: "10px", border: "1px solid var(--color-border)", background: "transparent", color: "white", cursor: "pointer" }}
            >
              Cancel
            </button>
            <button 
              onClick={() => handleDeleteGroup(groupId)}
              disabled={submitting}
              style={{ flex: 1, padding: "12px", borderRadius: "10px", border: "none", background: "#ef4444", color: "white", fontWeight: 600, cursor: submitting ? "not-allowed" : "pointer" }}
            >
              {submitting ? "Deleting..." : "Confirm Delete"}
            </button>
          </div>
        </div>
      </Modal>

      <style>{`
        @media (max-width: 600px) {
          .mobile-hide { display: none; }
          .mobile-only { display: inline; }
        }
        @media (min-width: 601px) {
          .mobile-only { display: none; }
        }
      `}</style>
    </div>
  );
}
