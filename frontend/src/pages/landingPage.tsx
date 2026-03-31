// ─── CostsCrunch — LandingPage ──────────────────────────────────────────────────
// Public marketing / home page. No auth required.

interface Props {
  onNavigate: (page: any) => void;
}

const FEATURES = [
  {
    icon: "📸",
    title: "AI Receipt Scanning",
    body: "Snap a photo and let Claude extract merchant, amount, date, and category in seconds. 94% average accuracy.",
  },
  {
    icon: "👥",
    title: "Group Expense Splitting",
    body: "Create groups for team offsites, client projects, or shared households. Debt-minimisation settles balances in one transfer.",
  },
  {
    icon: "📊",
    title: "Analytics",
    body: "Donut, stacked bar, bubble and horizontal bar charts with filters by period, category, currency, and scope.",
  },
  {
    icon: "⚡",
    title: "Serverless at Scale",
    body: "Built on AWS Lambda + DynamoDB Global Tables. P99 under 80ms. 99.99% availability SLA.",
  },
];

const STATS = [
  { value: "1M+",   label: "Expenses tracked" },
  { value: "94%",   label: "OCR accuracy"     },
  { value: "$0.004", label: "Per user / month" },
  { value: "80ms",  label: "P99 latency"      },
];

export default function LandingPage({ onNavigate }: Props) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--color-bg)",
        color: "var(--color-text)",
        fontFamily: "var(--font-body)",
        overflowX: "hidden",
      }}
    >
      {/* ── Nav ──────────────────────────────────────────────────────────────── */}
      <nav
        style={{
          position: "sticky",
          top: 0,
          zIndex: 100,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 48px",
          height: "64px",
          background: "rgba(6,14,26,0.85)",
          backdropFilter: "blur(16px)",
          borderBottom: "1px solid var(--color-border-dim)",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 800,
            fontSize: "20px",
            letterSpacing: "-0.5px",
            background: "linear-gradient(135deg, #0ea5e9, #6366f1)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            cursor: "pointer"
          }}
          onClick={() => onNavigate("landing")}
        >
          CostsCrunch
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            onClick={() => onNavigate("login")}
            style={{
              padding: "8px 20px",
              borderRadius: "9px",
              border: "1px solid var(--color-border)",
              background: "transparent",
              color: "var(--color-text-muted)",
              fontSize: "13px",
              fontWeight: 500,
              cursor: "pointer",
              transition: "all 0.15s",
            }}
          >
            Sign in
          </button>
          <button
            onClick={() => onNavigate("register")}
            style={{
              padding: "8px 20px",
              borderRadius: "9px",
              background: "linear-gradient(135deg, #0ea5e9, #6366f1)",
              border: "none",
              color: "#fff",
              fontSize: "13px",
              fontWeight: 700,
              cursor: "pointer",
              boxShadow: "0 0 20px rgba(99,102,241,0.35)",
            }}
          >
            Get started free
          </button>
        </div>
      </nav>

      {/* ── Main ─────────────────────────────────────────────────────────────── */}
      <main>
        {/* ── Hero ──────────────────────────────────────────────────────────── */}
        <section
          style={{
            position: "relative",
            padding: "120px 48px 100px",
            textAlign: "center",
            overflow: "hidden",
          }}
        >
          <div
            aria-hidden
            style={{
              position: "absolute",
              top: "10%",
              left: "50%",
              transform: "translateX(-50%)",
              width: "800px",
              height: "400px",
              background:
                "radial-gradient(ellipse at center, rgba(99,102,241,0.18) 0%, rgba(14,165,233,0.08) 50%, transparent 75%)",
              pointerEvents: "none",
            }}
          />

          <div
            style={{
              display: "inline-block",
              background: "rgba(99,102,241,0.12)",
              border: "1px solid rgba(99,102,241,0.3)",
              borderRadius: "40px",
              padding: "5px 16px",
              fontSize: "11px",
              fontWeight: 700,
              letterSpacing: "1.5px",
              textTransform: "uppercase",
              color: "#818cf8",
              marginBottom: "32px",
            }}
          >
            Now with AI receipt scanning
          </div>

          <h1
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "clamp(40px, 6vw, 76px)",
              fontWeight: 800,
              lineHeight: 1.0,
              letterSpacing: "-2px",
              color: "var(--color-text)",
              maxWidth: "860px",
              margin: "0 auto 28px",
            }}
          >
            Expense tracking
            <br />
            <span
              style={{
                background: "linear-gradient(135deg, #0ea5e9 0%, #6366f1 60%, #8b5cf6 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              that actually works.
            </span>
          </h1>

          <p
            style={{
              fontSize: "18px",
              color: "var(--color-text-dim)",
              maxWidth: "560px",
              margin: "0 auto 48px",
              lineHeight: 1.7,
            }}
          >
            AI-powered receipt scanning, group expense splitting, and real-time analytics.
            From solo freelancer to enterprise teams — one platform, zero spreadsheets.
          </p>

          <div style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap" }}>
            <button
              onClick={() => onNavigate("register")}
              aria-label="Get started free"
              style={{
                display: "inline-block",
                padding: "15px 36px",
                borderRadius: "12px",
                background: "linear-gradient(135deg, #0ea5e9, #6366f1)",
                border: "none",
                color: "#fff",
                fontWeight: 700,
                fontSize: "15px",
                cursor: "pointer",
                boxShadow: "0 0 40px rgba(99,102,241,0.4)",
                transition: "transform 0.15s, box-shadow 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateY(-2px)";
                e.currentTarget.style.boxShadow = "0 8px 48px rgba(99,102,241,0.5)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.boxShadow = "0 0 40px rgba(99,102,241,0.4)";
              }}
            >
              Get started — it&apos;s free →
            </button>
            <a
              href="#features"
              style={{
                display: "inline-block",
                padding: "15px 36px",
                borderRadius: "12px",
                border: "1px solid var(--color-border)",
                color: "var(--color-text-muted)",
                textDecoration: "none",
                fontWeight: 500,
                fontSize: "15px",
              }}
            >
              See how it works
            </a>
          </div>
        </section>

        {/* ── Stats Bar ─────────────────────────────────────────────────────── */}
        <section
          style={{
            display: "flex",
            justifyContent: "center",
            gap: "0",
            borderTop: "1px solid var(--color-border-dim)",
            borderBottom: "1px solid var(--color-border-dim)",
          }}
        >
          {STATS.map((s, i) => (
            <div
              key={s.label}
              style={{
                flex: 1,
                maxWidth: "200px",
                padding: "28px 24px",
                textAlign: "center",
                borderRight: i < STATS.length - 1 ? "1px solid var(--color-border-dim)" : "none",
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: "28px",
                  fontWeight: 800,
                  color: "#0ea5e9",
                  letterSpacing: "-1px",
                }}
              >
                {s.value}
              </div>
              <div style={{ fontSize: "12px", color: "var(--color-text-dim)", marginTop: "4px" }}>
                {s.label}
              </div>
            </div>
          ))}
        </section>

        {/* ── Features ──────────────────────────────────────────────────────── */}
        <section
          id="features"
          style={{ padding: "96px 48px" }}
        >
          <div style={{ textAlign: "center", marginBottom: "64px" }}>
            <h2
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "36px",
                fontWeight: 800,
                letterSpacing: "-1px",
                marginBottom: "12px",
              }}
            >
              Everything you need. Nothing you don&apos;t.
            </h2>
            <p style={{ color: "var(--color-text-dim)", fontSize: "16px" }}>
              Built for modern finance teams and solo operators alike.
            </p>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
              gap: "20px",
              maxWidth: "1080px",
              margin: "0 auto",
            }}
          >
            {FEATURES.map((f) => (
              <article
                key={f.title}
                style={{
                  background: "var(--color-surface)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "18px",
                  padding: "28px",
                  transition: "border-color 0.2s, transform 0.2s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "rgba(99,102,241,0.4)";
                  e.currentTarget.style.transform = "translateY(-3px)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "var(--color-border)";
                  e.currentTarget.style.transform = "translateY(0)";
                }}
              >
                <div style={{ fontSize: "28px", marginBottom: "14px" }}>{f.icon}</div>
                <h3
                  style={{
                    fontFamily: "var(--font-display)",
                    fontWeight: 700,
                    fontSize: "16px",
                    marginBottom: "10px",
                    color: "var(--color-text)",
                  }}
                >
                  {f.title}
                </h3>
                <p style={{ fontSize: "13px", color: "var(--color-text-dim)", lineHeight: 1.65 }}>
                  {f.body}
                </p>
              </article>
            ))}
          </div>
        </section>

        {/* ── Pricing ───────────────────────────────────────────────────────── */}
        <section
          id="pricing"
          style={{
            padding: "96px 48px",
            background: "var(--color-surface-3)",
            borderTop: "1px solid var(--color-border-dim)",
          }}
        >
          <div style={{ textAlign: "center", marginBottom: "60px" }}>
            <h2
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "36px",
                fontWeight: 800,
                letterSpacing: "-1px",
                marginBottom: "12px",
              }}
            >
              Simple, transparent pricing
            </h2>
            <p style={{ color: "var(--color-text-dim)", fontSize: "16px" }}>
              Free plan available. No credit card required to start.
            </p>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: "20px",
              maxWidth: "880px",
              margin: "0 auto",
            }}
          >
            {[
              {
                name: "Free",
                price: "$0",
                period: "forever",
                features: ["50 expenses / month", "1 group", "CSV import", "Email support"],
                cta: "Get started free",
                page: "register",
                highlight: false,
              },
              {
                name: "Pro",
                price: "$9",
                period: "per month",
                features: ["Unlimited expenses", "Unlimited groups", "AI receipt scanning", "PDF import", "Priority support"],
                cta: "Try Pro free",
                page: "register",
                highlight: true,
              },
              {
                name: "Business",
                price: "$29",
                period: "per user / month",
                features: ["Everything in Pro", "Team approval workflows", "QuickBooks & Xero sync", "SAML SSO", "SLA 99.99%"],
                cta: "Contact sales",
                page: "register",
                highlight: false,
              },
            ].map((plan) => (
              <div
                key={plan.name}
                style={{
                  background: plan.highlight ? "var(--color-surface)" : "transparent",
                  border: plan.highlight
                    ? "1px solid rgba(99,102,241,0.5)"
                    : "1px solid var(--color-border)",
                  borderRadius: "18px",
                  padding: "32px 28px",
                  position: "relative",
                  boxShadow: plan.highlight ? "0 0 40px rgba(99,102,241,0.15)" : "none",
                }}
              >
                {plan.highlight && (
                  <div
                    style={{
                      position: "absolute",
                      top: "-12px",
                      left: "50%",
                      transform: "translateX(-50%)",
                      background: "linear-gradient(135deg, #0ea5e9, #6366f1)",
                      borderRadius: "40px",
                      padding: "4px 14px",
                      fontSize: "10px",
                      fontWeight: 700,
                      letterSpacing: "1px",
                      textTransform: "uppercase",
                      color: "#fff",
                    }}
                  >
                    Most popular
                  </div>
                )}
                <div
                  style={{
                    fontFamily: "var(--font-display)",
                    fontWeight: 700,
                    fontSize: "16px",
                    marginBottom: "16px",
                    color: plan.highlight ? "#818cf8" : "var(--color-text)",
                  }}
                >
                  {plan.name}
                </div>
                <div style={{ marginBottom: "24px" }}>
                  <span
                    style={{
                      fontFamily: "var(--font-display)",
                      fontSize: "40px",
                      fontWeight: 800,
                      letterSpacing: "-2px",
                    }}
                  >
                    {plan.price}
                  </span>
                  <span
                    style={{ fontSize: "13px", color: "var(--color-text-dim)", marginLeft: "6px" }}
                  >
                    {plan.period}
                  </span>
                </div>
                <ul style={{ listStyle: "none", marginBottom: "28px" }}>
                  {plan.features.map((f) => (
                    <li
                      key={f}
                      style={{
                        fontSize: "13px",
                        color: "var(--color-text-muted)",
                        padding: "6px 0",
                        borderBottom: "1px solid var(--color-border-dim)",
                        display: "flex",
                        gap: "8px",
                        alignItems: "center",
                      }}
                    >
                      <span style={{ color: "#10b981", flexShrink: 0 }}>✓</span>
                      {f}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => onNavigate(plan.page)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "center",
                    padding: "11px",
                    borderRadius: "10px",
                    border: plan.highlight
                      ? "none"
                      : "1px solid var(--color-border)",
                    background: plan.highlight
                      ? "linear-gradient(135deg, #0ea5e9, #6366f1)"
                      : "transparent",
                    color: plan.highlight ? "#fff" : "var(--color-text-muted)",
                    fontWeight: 700,
                    fontSize: "13px",
                    cursor: "pointer",
                  }}
                >
                  {plan.cta}
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* ── Footer CTA ────────────────────────────────────────────────────── */}
        <section
          style={{
            padding: "96px 48px",
            textAlign: "center",
          }}
        >
          <h2
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "40px",
              fontWeight: 800,
              letterSpacing: "-1.5px",
              marginBottom: "20px",
            }}
          >
            Start tracking smarter today.
          </h2>
          <p style={{ color: "var(--color-text-dim)", marginBottom: "36px" }}>
            Free forever plan. No credit card. Setup in 2 minutes.
          </p>
          <button
            onClick={() => onNavigate("register")}
            style={{
              display: "inline-block",
              padding: "15px 40px",
              borderRadius: "12px",
              background: "linear-gradient(135deg, #0ea5e9, #6366f1)",
              border: "none",
              color: "#fff",
              fontWeight: 700,
              fontSize: "15px",
              cursor: "pointer",
              boxShadow: "0 0 40px rgba(99,102,241,0.4)",
            }}
          >
            Sign up free — no card needed
          </button>
        </section>
      </main>

      {/* ── Footer ───────────────────────────────────────────────────────────── */}
      <footer
        style={{
          borderTop: "1px solid var(--color-border-dim)",
          padding: "24px 48px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: "12px",
          color: "var(--color-text-dim)",
        }}
      >
        <span style={{ fontFamily: "var(--font-display)", fontWeight: 700 }}>CostsCrunch</span>
        <span>© 2026 CostsCrunch Inc. · Privacy · Terms</span>
      </footer>
    </div>
  );
}
