// __mocks__/@aws-lambda-powertools/logger.ts
import { vi } from 'vitest';

export const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),               // often used in dev
  appendKeys: vi.fn(),
  removeKeys: vi.fn(),           // sometimes used
  refreshSampleRate: vi.fn(),    // advanced feature
};

export const Logger = vi.fn().mockImplementation(() => mockLogger);