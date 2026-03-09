// __mocks__/@aws-lambda-powertools/metrics.ts
import { vi } from 'vitest';

export const mockMetrics = {
  addMetric: vi.fn(),
  addDimension: vi.fn(),          // common
  addMetadata: vi.fn(),            // sometimes used
  publishStoredMetrics: vi.fn(),   // for manual flushing
  clearMetrics: vi.fn(),           // helpful in tests
  clearDimensions: vi.fn(),
  throwOnEmptyMetrics: vi.fn(),    // configuration
};

export const Metrics = vi.fn().mockImplementation(() => mockMetrics);

export const MetricUnit = {
  Count: 'Count',
  Milliseconds: 'Milliseconds',
  Bytes: 'Bytes',                 // added for completeness
  Percent: 'Percent',
  NoUnit: 'NoUnit',
};