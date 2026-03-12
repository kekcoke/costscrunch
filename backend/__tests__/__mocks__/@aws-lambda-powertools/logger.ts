// __mocks__/@aws-lambda-powertools/logger.ts
import { vi } from 'vitest';

// Use vi.hoisted to define spies that survive the hoisting of vi.mock
const hoisted = vi.hoisted(() => {
  const mockLoggerInstance = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    appendKeys: vi.fn(),
    removeKeys: vi.fn(),
    refreshSampleRate: vi.fn(),
  };

  // Mock constructor – can be a vi.fn() or a class
  const Logger = vi.fn().mockImplementation(() => mockLoggerInstance);

  return { mockLoggerInstance, Logger };
});

export const mockLogger = hoisted.mockLoggerInstance;
export const Logger = hoisted.Logger;

// Apply the mock – this will be hoisted within this module
vi.mock('@aws-lambda-powertools/logger', () => ({
  Logger: hoisted.Logger,
}));
