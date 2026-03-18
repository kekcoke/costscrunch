// ─── Infrastructure Test Setup ──────────────────────────────────────────────
// Vitest 4.x globalSetup runs in an isolated context — no beforeAll/afterAll.
// Each test suite handles its own LocalStack health check via describe.skipIf.

export default function setup() {
  // Intentionally empty — opt2 tests self-skip when LocalStack is unreachable
}
