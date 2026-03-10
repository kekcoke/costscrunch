// __mocks__/@aws-lambda-powertools/metrics.ts
import { vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const mockMetricsInstance = {
    addMetric: vi.fn(),
    addDimension: vi.fn(),          // common
    addMetadata: vi.fn(),            // sometimes used
    publishStoredMetrics: vi.fn(),   // for manual flushing
    clearMetrics: vi.fn(),           // helpful in tests
    clearDimensions: vi.fn(),
    throwOnEmptyMetrics: vi.fn(),    // configuration
  };

  const Metrics = vi.fn().mockImplementation(() => mockMetricsInstance);

  return { mockMetricsInstance, Metrics }
});


export const mockMetrics = hoisted.mockMetricsInstance;
export const Metrics = hoisted.Metrics;

export const MetricUnit = {
  Count: 'Count',
  Milliseconds: 'Milliseconds',
  Bytes: 'Bytes',                 // added for completeness
  Percent: 'Percent',
  NoUnit: 'NoUnit',
};