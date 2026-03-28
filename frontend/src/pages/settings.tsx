// ─── CostsCrunch — SettingsPage ──────────────────────────────────────────────
import { useState, useEffect } from "react";
import { profileApi } from "../services/api.js";

export function SettingsPage() {
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    profileApi.get()
      .then(setProfile)
      .catch(() => setMessage({ type: "error", text: "Failed to load profile" }))
      .finally(() => setLoading(false));
  }, []);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const updated = await profileApi.update({
        name: profile.name,
        currency: profile.currency,
        timezone: profile.timezone,
        notificationPreferences: profile.notificationPreferences
      });
      setProfile(updated);
      setMessage({ type: "success", text: "Profile updated successfully" });
    } catch (err: any) {
      setMessage({ type: "error", text: err.response?.data?.error || "Failed to update profile" });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div style={{ padding: "40px", textAlign: "center", color: "var(--color-text-dim)" }}>Loading settings...</div>;

  return (
    <div style={{ animation: "fadeUp 0.4s both", maxWidth: "640px" }}>
      <header className="page-header" style={{ marginBottom: "20px" }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: "24px", fontWeight: 700, letterSpacing: "-0.5px", margin: 0 }}>
          Settings
        </h1>
        <div style={{ fontSize: "12px", color: "var(--color-text-dim)", marginTop: "4px" }}>
          Account and preferences
        </div>
      </header>

      {message && (
        <div style={{ 
          padding: "12px", 
          borderRadius: "8px", 
          marginBottom: "16px",
          fontSize: "13px",
          background: message.type === "success" ? "rgba(16, 185, 129, 0.1)" : "rgba(239, 68, 68, 0.1)",
          color: message.type === "success" ? "#10b981" : "#ef4444",
          border: `1px solid ${message.type === "success" ? "rgba(16, 185, 129, 0.2)" : "rgba(239, 68, 68, 0.2)"}`
        }}>
          {message.text}
        </div>
      )}

      <form onSubmit={handleUpdate}>
        <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "16px", padding: "24px", marginBottom: "16px" }}>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "15px", marginBottom: "16px" }}>Profile</div>
          
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "12px", color: "var(--color-text-dim)" }}>
              Full Name
              <input 
                type="text" 
                value={profile.name || ""} 
                onChange={e => setProfile({...profile, name: e.target.value})}
                style={{ background: "var(--color-surface-2)", color: "var(--color-text)", border: "1px solid var(--color-border)", borderRadius: "8px", padding: "8px 12px" }}
              />
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "12px", color: "var(--color-text-dim)" }}>
              Currency
              <select 
                value={profile.currency || "USD"} 
                onChange={e => setProfile({...profile, currency: e.target.value})}
                style={{ background: "var(--color-surface-2)", color: "var(--color-text)", border: "1px solid var(--color-border)", borderRadius: "8px", padding: "8px 12px" }}
              >
                <option value="USD">USD ($)</option>
                <option value="EUR">EUR (€)</option>
                <option value="GBP">GBP (£)</option>
              </select>
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "12px", color: "var(--color-text-dim)" }}>
              Timezone
              <select 
                value={profile.timezone || "UTC"} 
                onChange={e => setProfile({...profile, timezone: e.target.value})}
                style={{ background: "var(--color-surface-2)", color: "var(--color-text)", border: "1px solid var(--color-border)", borderRadius: "8px", padding: "8px 12px" }}
              >
                <option value="UTC">UTC</option>
                <option value="America/New_York">America/New_York</option>
                <option value="Europe/London">Europe/London</option>
                <option value="Asia/Tokyo">Asia/Tokyo</option>
              </select>
            </label>
          </div>
        </div>

        <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "16px", padding: "24px", marginBottom: "24px" }}>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "15px", marginBottom: "16px" }}>Notifications</div>
          
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {[
              { key: "email", label: "Email notifications" },
              { key: "push", label: "Push notifications" },
              { key: "sms", label: "SMS alerts" }
            ].map(pref => (
              <label key={pref.key} style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "13px", cursor: "pointer" }}>
                <input 
                  type="checkbox" 
                  checked={profile.notificationPreferences?.[pref.key] || false}
                  onChange={e => setProfile({
                    ...profile, 
                    notificationPreferences: { ...profile.notificationPreferences, [pref.key]: e.target.checked }
                  })}
                />
                {pref.label}
              </label>
            ))}
          </div>
        </div>

        <button 
          type="submit" 
          disabled={saving}
          style={{ 
            width: "100%", 
            background: "var(--color-indigo)", 
            color: "white", 
            border: "none", 
            borderRadius: "12px", 
            padding: "12px", 
            fontWeight: 600, 
            cursor: saving ? "not-allowed" : "pointer",
            opacity: saving ? 0.7 : 1,
            transition: "opacity 0.2s"
          }}
        >
          {saving ? "Saving Changes..." : "Save Changes"}
        </button>
      </form>
    </div>
  );
}
