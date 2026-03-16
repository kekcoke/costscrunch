import { useState, useEffect } from "react";
import type { Group } from "../../models/types";
import { groupsApi } from "../../services/api";
import { LoadingSpinner } from "../spinner";

// ─── Group Detail Component ──────────────────────────────────────────────────
export default function GroupDetail({ groupId, onBack }: { groupId: string, onBack: () => void }) {
  const [group, setGroup] = useState<Group | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    groupsApi.get(groupId)
      .then((data) => setGroup(data))
      .finally(() => setLoading(false));
  }, [groupId]);
  if (loading) return <LoadingSpinner size="40px" />;
  if (!group) return <div>Group not found.</div>;

  const mockMembers = [
    { id: "1", name: "Alex Rivera", role: "Owner", avatar: "AR" },
    { id: "2", name: "Jordan Smith", role: "Member", avatar: "JS" },
    { id: "3", name: "Casey Chen", role: "Member", avatar: "CC" },
  ];

  return (
    <div style={{ animation: "fadeUp 0.4s both" }}>
      <button onClick={onBack} style={{ background: "none", border: "none", color: "var(--color-indigo)", cursor: "pointer", fontWeight: 600, marginBottom: "20px", padding: 0 }}>
        ← Back to Groups
      </button>
      
      {/* Row 1: Header Info */}
      <div style={{ background: "var(--color-surface)", padding: "24px", borderRadius: "18px", border: `1px solid ${group.color}33`, marginBottom: "20px" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: "28px", margin: 0 }}>{group.name}</h2>
        <div style={{ color: "var(--color-text-dim)", marginTop: "4px" }}>{group.members} Members Total</div>
      </div>

      {/* Row 2: Members List */}
      <div style={{ background: "var(--color-surface)", padding: "24px", borderRadius: "18px", border: "1px solid var(--color-border-dim)" }}>
        <h3 style={{ fontSize: "16px", marginBottom: "16px" }}>Group Members</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {mockMembers.map(m => (
            <div key={m.id} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "12px", background: "var(--color-surface-2)", borderRadius: "12px" }}>
              <div style={{ width: "36px", height: "36px", borderRadius: "50%", background: "var(--color-indigo)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", fontWeight: 700, color: "white" }}>
                {m.avatar}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{m.name}</div>
                <div style={{ fontSize: "11px", color: "var(--color-text-dim)" }}>{m.role}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}