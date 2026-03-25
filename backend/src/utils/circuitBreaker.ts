// ─── Circuit Breaker Utility ──────────────────────────────────────────────
// Implements a state machine: CLOSED → OPEN → HALF_OPEN → CLOSED/OPEN
//
// State transitions:
//   CLOSED    — normal operation; failures increment a counter
//   OPEN      — all calls rejected immediately with CircuitOpenError
//   HALF_OPEN — after cooldown period, a single probe request is allowed
//               through; success resets to CLOSED, failure returns to OPEN
//
// Lambda context:
//   Module-level instances persist across warm invocations in the same
//   container. Cold starts reset state to CLOSED (safe default).

import { CircuitOpenError } from "./errors.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export enum CircuitState {
  CLOSED = "CLOSED",
  OPEN = "OPEN",
  HALF_OPEN = "HALF_OPEN",
}

export interface CircuitBreakerConfig {
  /** Name used in error messages and logging. */
  name: string;
  /** Consecutive failures before transitioning CLOSED → OPEN. Default: 5. */
  failureThreshold?: number;
  /** Milliseconds before transitioning OPEN → HALF_OPEN. Default: 30_000. */
  cooldownMs?: number;
  /** Number of probe requests allowed in HALF_OPEN. Default: 1. */
  halfOpenMaxProbes?: number;
  /** Injectable clock for testing. Default: Date.now (UTC). */
  now?: () => number;
}

interface CircuitBreakerState {
  state: CircuitState;
  failureCount: number;
  openedAt: number | null;       // UTC ms when last entered OPEN
  halfOpenProbes: number;        // probes issued in current HALF_OPEN window
}

// ─── Implementation ───────────────────────────────────────────────────────────

export function createCircuitBreaker(config: CircuitBreakerConfig) {
  const {
    name,
    failureThreshold = 5,
    cooldownMs = 30_000,
    halfOpenMaxProbes = 1,
    now = Date.now,
  } = config;

  const state: CircuitBreakerState = {
    state: CircuitState.CLOSED,
    failureCount: 0,
    openedAt: null,
    halfOpenProbes: 0,
  };

  function getState(): CircuitState {
    if (state.state === CircuitState.OPEN) {
      if (state.openedAt !== null && now() - state.openedAt >= cooldownMs) {
        transitionTo(CircuitState.HALF_OPEN);
      }
    }
    return state.state;
  }

  function transitionTo(next: CircuitState): void {
    switch (next) {
      case CircuitState.CLOSED:
        state.failureCount = 0;
        state.halfOpenProbes = 0;
        state.openedAt = null;
        break;
      case CircuitState.OPEN:
        state.openedAt = now();
        state.halfOpenProbes = 0;
        break;
      case CircuitState.HALF_OPEN:
        state.halfOpenProbes = 0;
        break;
    }
    state.state = next;
  }

  function onSuccess(): void {
    if (state.state === CircuitState.HALF_OPEN) {
      transitionTo(CircuitState.CLOSED);
    } else {
      // CLOSED — reset failure counter on any success
      state.failureCount = 0;
    }
  }

  function onFailure(): void {
    if (state.state === CircuitState.HALF_OPEN) {
      transitionTo(CircuitState.OPEN);
    } else {
      // CLOSED — increment and check threshold
      state.failureCount++;
      if (state.failureCount >= failureThreshold) {
        transitionTo(CircuitState.OPEN);
      }
    }
  }

  /**
   * Execute `fn` through the circuit breaker.
   * Throws `CircuitOpenError` when the circuit is OPEN or when HALF_OPEN
   * probe slots are exhausted.
   */
  async function execute<T>(fn: () => Promise<T>): Promise<T> {
    const current = getState();

    if (current === CircuitState.OPEN) {
      throw new CircuitOpenError(
        `Circuit "${name}" is OPEN — rejecting request (cooldown ${cooldownMs}ms)`
      );
    }

    if (current === CircuitState.HALF_OPEN) {
      if (state.halfOpenProbes >= halfOpenMaxProbes) {
        throw new CircuitOpenError(
          `Circuit "${name}" is HALF_OPEN — probe limit reached, rejecting request`
        );
      }
      state.halfOpenProbes++;
    }

    try {
      const result = await fn();
      onSuccess();
      return result;
    } catch (error) {
      onFailure();
      throw error;
    }
  }

  /**
   * Force the circuit into a specific state. For testing only.
   */
  function _setState(s: CircuitState, openedAt?: number): void {
    state.state = s;
    state.openedAt = openedAt ?? (s === CircuitState.OPEN ? now() : null);
    state.halfOpenProbes = 0;
    if (s === CircuitState.CLOSED) state.failureCount = 0;
  }

  /**
   * Read the internal state. For testing only.
   */
  function _getState(): Readonly<CircuitBreakerState> {
    return { ...state };
  }

  return { execute, getState, _setState, _getState };
}
