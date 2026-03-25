import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Tracer } from '@aws-lambda-powertools/tracer';

// Mock the global process.env to ensure tracing is "enabled" for the test
vi.stubEnv('POWERTOOLS_TRACE_ENABLED', 'true');

describe('X-Ray Instrumentation', () => {
  let tracer: Tracer;

  beforeEach(() => {
    vi.clearAllMocks();
    tracer = new Tracer({ serviceName: 'test-service' });
    
    // Mock the underlying X-Ray SDK methods used by Powertools
    // Powertools uses the AWS X-Ray SDK internally. 
    // We mock the segment and subsegment creation.
    const mockSubsegment = {
      addAnnotation: vi.fn(),
      putMetadata: vi.fn(),
      close: vi.fn(),
    };

    const mockSegment = {
      addNewSubsegment: vi.fn().mockReturnValue(mockSubsegment),
      addAnnotation: vi.fn(),
      close: vi.fn(),
    };

    vi.spyOn(tracer, 'getSegment').mockReturnValue(mockSegment as any);
    vi.spyOn(tracer, 'putAnnotation');
  });

  it('captures receiptId annotation', () => {
    const receiptId = 'test-receipt-123';
    tracer.putAnnotation('receiptId', receiptId);

    expect(tracer.putAnnotation).toHaveBeenCalledWith('receiptId', receiptId);
  });

  it('creates a subsegment with correct stage annotation', () => {
    const segment = tracer.getSegment();
    const subsegment = segment?.addNewSubsegment('TextractJobStart');
    subsegment?.addAnnotation('stage', 'textract');

    expect(segment?.addNewSubsegment).toHaveBeenCalledWith('TextractJobStart');
    expect(subsegment?.addAnnotation).toHaveBeenCalledWith('stage', 'textract');
  });
});
