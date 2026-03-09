// __mocks__/@aws-lambda-powertools/tracer.ts
import { vi } from 'vitest';

export const mockSubsegment = {
  close: vi.fn(),
  addAnnotation: vi.fn(),        // common
  addMetadata: vi.fn(),           // common
};

export const mockSegment = {
  addNewSubsegment: vi.fn().mockReturnValue(mockSubsegment),
};

export const mockTracer = {
  getSegment: vi.fn().mockReturnValue(mockSegment),
  putAnnotation: vi.fn(),         // often used directly
  putMetadata: vi.fn(),
  captureLambdaHandler: vi.fn(),  // for decorators
  captureMethod: vi.fn(),
};

export const Tracer = vi.fn().mockImplementation(() => mockTracer);