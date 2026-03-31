// ─── Circuit Breaker — Unit Tests ─────────────────────────────────────────
// Tests all state transitions: CLOSED → OPEN → HALF_OPEN → CLOSED/OPEN
// Uses injectable clock to control OPEN → HALF_OPEN timing without vi.useFakeTimers.

import { describe, it, expect, beforeEach } from "vitest";
import {
  createCircuitBreaker,
  CircuitState,
} from "../../src/utils/circuitBreaker.js";
import { CircuitOpenError } from "../../src/utils/errors.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Create a breaker with a controllable clock and short cooldown for fast tests. */
function createTestBreaker(opts: { threshold?: number; cooldownMs?: number } = {}) {
  let currentTime = 0;
  const clock = () => currentTime;

  const breaker = createCircuitBreaker({
    name: "test",
    failureThreshold: opts.threshold ?? 5,
    cooldownMs: opts.cooldownMs ?? 30_000,
    now: clock,
  });

  return {
    breaker,
    advance: (ms: number) => { currentTime += ms; },
    time: () => currentTime,
  };
}

const ok = () => Promise.resolve("ok");
const fail = () => Promise.reject(new Error("boom"));

// ═══════════════════════════════════════════════════════════════════════════════
// CLOSED state — normal operation
// ═══════════════════════════════════════════════════════════════════════════════
describe("CLOSED state", () => {
  it("passes calls through and returns result", async () => {
    const { breaker } = createTestBreaker();
    await expect(breaker.execute(ok)).resolves.toBe("ok");
  });

  it("resets failure counter on success", async () => {
    const { breaker } = createTestBreaker({ threshold: 3 });
    // 2 failures then 1 success → counter resets
    await breaker.execute(fail).catch(() => {});
    await breaker.execute(fail).catch(() => {});
    await breaker.execute(ok);
    // Need 3 more failures to trip (not 1)
    await breaker.execute(fail).catch(() => {});
    expect(breaker._getState().state).toBe(CircuitState.CLOSED);
  });

  it("starts in CLOSED state with zero failures", () => {
    const { breaker } = createTestBreaker();
    expect(breaker._getState()).toMatchObject({
      state: CircuitState.CLOSED,
      failureCount: 0,
      openedAt: null,
      halfOpenProbes: 0,
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CLOSED → OPEN transition
// ═══════════════════════════════════════════════════════════════════════════════
describe("CLOSED → OPEN", () => {
  it("transitions after exactly N consecutive failures", async () => {
    const { breaker } = createTestBreaker({ threshold: 5 });

    for (let i = 0; i < 4; i++) {
      await breaker.execute(fail).catch(() => {});
      expect(breaker._getState().state).toBe(CircuitState.CLOSED);
    }

    // 5th failure trips the breaker
    await breaker.execute(fail).catch(() => {});
    expect(breaker._getState().state).toBe(CircuitState.OPEN);
    expect(breaker._getState().openedAt).toBe(0); // set by clock at transition time
  });

  it("records the UTC timestamp when entering OPEN", async () => {
    const { breaker, advance } = createTestBreaker({ threshold: 2 });
    advance(1000);

    await breaker.execute(fail).catch(() => {});
    await breaker.execute(fail).catch(() => {});

    expect(breaker._getState().openedAt).toBe(1000);
  });

  it("uses custom threshold from config", async () => {
    const { breaker } = createTestBreaker({ threshold: 3 });

    await breaker.execute(fail).catch(() => {});
    await breaker.execute(fail).catch(() => {});
    expect(breaker._getState().state).toBe(CircuitState.CLOSED);

    await breaker.execute(fail).catch(() => {});
    expect(breaker._getState().state).toBe(CircuitState.OPEN);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// OPEN state — rejecting requests
// ═══════════════════════════════════════════════════════════════════════════════
describe("OPEN state", () => {
  it("throws CircuitOpenError without calling the function", async () => {
    const { breaker } = createTestBreaker({ threshold: 1 });
    const fn = vi.fn().mockResolvedValue("should not run");

    await breaker.execute(fail).catch(() => {}); // trip breaker
    await expect(breaker.execute(fn)).rejects.toThrow(CircuitOpenError);
    expect(fn).not.toHaveBeenCalled();
  });

  it("includes breaker name in error message", async () => {
    const { breaker } = createTestBreaker({ threshold: 1 });

    await breaker.execute(fail).catch(() => {});
    await expect(breaker.execute(ok)).rejects.toThrow(/"test"/);
  });

  it("includes cooldown duration in error message", async () => {
    const { breaker } = createTestBreaker({ threshold: 1, cooldownMs: 60_000 });

    await breaker.execute(fail).catch(() => {});
    await expect(breaker.execute(ok)).rejects.toThrow(/60000ms/);
  });

  it("does not increment failure count while OPEN", async () => {
    const { breaker } = createTestBreaker({ threshold: 1 });
    await breaker.execute(fail).catch(() => {}); // OPEN

    await breaker.execute(ok).catch(() => {});   // rejected, no fn call
    await breaker.execute(ok).catch(() => {});   // rejected, no fn call
    expect(breaker._getState().failureCount).toBe(1); // still 1 from the trip
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// OPEN → HALF_OPEN transition (after cooldown)
// ═══════════════════════════════════════════════════════════════════════════════
describe("OPEN → HALF_OPEN", () => {
  it("transitions after cooldown period elapses", async () => {
    const { breaker, advance } = createTestBreaker({ threshold: 1, cooldownMs: 30_000 });
    await breaker.execute(fail).catch(() => {}); // OPEN at t=0

    expect(breaker.getState()).toBe(CircuitState.OPEN);

    advance(29_999);
    expect(breaker.getState()).toBe(CircuitState.OPEN); // not yet

    advance(1);
    expect(breaker.getState()).toBe(CircuitState.HALF_OPEN); // exactly at threshold
  });

  it("allows one probe request through in HALF_OPEN", async () => {
    const { breaker, advance } = createTestBreaker({ threshold: 1, cooldownMs: 30_000 });
    await breaker.execute(fail).catch(() => {});
    advance(30_000); // → HALF_OPEN

    const fn = vi.fn().mockResolvedValue("probe result");
    await expect(breaker.execute(fn)).resolves.toBe("probe result");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(breaker._getState().state).toBe(CircuitState.CLOSED); // probe success → CLOSED
  });

  it("rejects additional requests beyond probe limit", async () => {
    const { breaker, advance } = createTestBreaker({
      threshold: 1,
      cooldownMs: 30_000,
    });
    await breaker.execute(fail).catch(() => {});
    advance(30_000); // → HALF_OPEN

    // First call is the probe — use a pending promise to hold the slot
    let resolveProbe: (value: string | PromiseLike<string>) => void;
    const probePromise = new Promise<string>(r => { resolveProbe = r; });
    const probeCall = breaker.execute(() => probePromise);

    // Second call while probe is in-flight should be rejected
    await expect(breaker.execute(ok)).rejects.toThrow(CircuitOpenError);
    await expect(breaker.execute(ok)).rejects.toThrow(/probe limit/);

    // Resolve the probe
    resolveProbe!("ok");
    await probeCall;
    expect(breaker._getState().state).toBe(CircuitState.CLOSED);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// HALF_OPEN → CLOSED (probe succeeds)
// ═══════════════════════════════════════════════════════════════════════════════
describe("HALF_OPEN → CLOSED", () => {
  it("resets failure counter to 0", async () => {
    const { breaker, advance } = createTestBreaker({ threshold: 3, cooldownMs: 30_000 });

    await breaker.execute(fail).catch(() => {});
    await breaker.execute(fail).catch(() => {});
    await breaker.execute(fail).catch(() => {}); // OPEN, failureCount=3

    advance(30_000); // → HALF_OPEN
    await breaker.execute(ok); // probe success → CLOSED

    expect(breaker._getState()).toMatchObject({
      state: CircuitState.CLOSED,
      failureCount: 0,
      halfOpenProbes: 0,
    });
  });

  it("clears openedAt timestamp", async () => {
    const { breaker, advance } = createTestBreaker({ threshold: 1, cooldownMs: 30_000 });
    await breaker.execute(fail).catch(() => {}); // OPEN, openedAt=0
    advance(30_000);
    await breaker.execute(ok); // → CLOSED

    expect(breaker._getState().openedAt).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// HALF_OPEN → OPEN (probe fails)
// ═══════════════════════════════════════════════════════════════════════════════
describe("HALF_OPEN → OPEN", () => {
  it("returns to OPEN when probe fails", async () => {
    const { breaker, advance } = createTestBreaker({ threshold: 1, cooldownMs: 30_000 });
    await breaker.execute(fail).catch(() => {}); // OPEN at t=0
    advance(30_000); // → HALF_OPEN

    await expect(breaker.execute(fail)).rejects.toThrow("boom");
    expect(breaker._getState().state).toBe(CircuitState.OPEN);
  });

  it("sets a fresh openedAt timestamp (new cooldown period)", async () => {
    const { breaker, advance } = createTestBreaker({ threshold: 1, cooldownMs: 30_000 });
    await breaker.execute(fail).catch(() => {}); // OPEN at t=0
    advance(30_000); // → HALF_OPEN at t=30_000

    await breaker.execute(fail).catch(() => {}); // → OPEN again
    expect(breaker._getState().openedAt).toBe(30_000); // new cooldown starts now

    // Still OPEN after 29_999ms from new openedAt
    advance(29_999);
    expect(breaker.getState()).toBe(CircuitState.OPEN);

    // HALF_OPEN after full cooldown from new openedAt
    advance(1);
    expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);
  });

  it("rejects subsequent calls until new cooldown elapses", async () => {
    const { breaker, advance } = createTestBreaker({ threshold: 1, cooldownMs: 30_000 });
    await breaker.execute(fail).catch(() => {}); // OPEN at t=0
    advance(30_000); // → HALF_OPEN
    await breaker.execute(fail).catch(() => {}); // → OPEN at t=30_000

    // Immediately rejected
    await expect(breaker.execute(ok)).rejects.toThrow(CircuitOpenError);
    expect(breaker._getState().halfOpenProbes).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getState() — lazy transition evaluation
// ═══════════════════════════════════════════════════════════════════════════════
describe("getState()", () => {
  it("lazily transitions OPEN → HALF_OPEN when called after cooldown", async () => {
    const { breaker, advance } = createTestBreaker({ threshold: 1, cooldownMs: 30_000 });
    await breaker.execute(fail).catch(() => {}); // OPEN

    advance(30_000);
    // getState() triggers the lazy transition
    expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);
    // Internal state is also updated
    expect(breaker._getState().state).toBe(CircuitState.HALF_OPEN);
  });

  it("does not transition before cooldown even if getState is called repeatedly", async () => {
    const { breaker, advance } = createTestBreaker({ threshold: 1, cooldownMs: 30_000 });
    await breaker.execute(fail).catch(() => {}); // OPEN

    for (let t = 0; t < 29_000; t += 1000) {
      advance(1000);
      expect(breaker.getState()).toBe(CircuitState.OPEN);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// _setState — test helper
// ═══════════════════════════════════════════════════════════════════════════════
describe("_setState (test helper)", () => {
  it("forces OPEN state with custom openedAt", () => {
    const { breaker } = createTestBreaker();
    breaker._setState(CircuitState.OPEN, 50_000);

    expect(breaker._getState()).toMatchObject({
      state: CircuitState.OPEN,
      openedAt: 50_000,
      halfOpenProbes: 0,
    });
  });

  it("forces CLOSED state and resets failure count", () => {
    const { breaker } = createTestBreaker({ threshold: 3 });
    breaker._setState(CircuitState.OPEN);

    breaker._setState(CircuitState.CLOSED);
    expect(breaker._getState().failureCount).toBe(0);
  });

  it("returns a shallow copy from _getState to prevent external mutation", () => {
    const { breaker } = createTestBreaker();
    const snapshot = breaker._getState();
    (snapshot as any).failureCount = 99;

    expect(breaker._getState().failureCount).toBe(0); // original unchanged
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Error propagation — original error is re-thrown (not swallowed)
// ═══════════════════════════════════════════════════════════════════════════════
describe("error propagation", () => {
  it("re-throws the original error (not CircuitOpenError) in CLOSED state", async () => {
    const { breaker } = createTestBreaker();
    const original = new TypeError("invalid argument");

    await expect(breaker.execute(() => Promise.reject(original)))
      .rejects.toBe(original);
  });

  it("re-throws the original error in HALF_OPEN probe failure", async () => {
    const { breaker, advance } = createTestBreaker({ threshold: 1, cooldownMs: 30_000 });
    await breaker.execute(fail).catch(() => {}); // OPEN
    advance(30_000); // → HALF_OPEN

    const original = new RangeError("out of bounds");
    await expect(breaker.execute(() => Promise.reject(original)))
      .rejects.toBe(original);
  });
});
