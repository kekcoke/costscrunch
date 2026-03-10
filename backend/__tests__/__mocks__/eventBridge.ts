// __mocks__/@aws-sdk/client-eventbridge.ts
import { vi } from 'vitest';

// Mock instance of EventBridgeClient with spyable send method
export const mockEventBridgeClient = {
  send: vi.fn(),
  // Add other methods if needed (e.g., middlewareStack, config)
};

// Mock the EventBridgeClient constructor to return the mock instance
export const EventBridgeClient = vi.fn().mockImplementation(() => mockEventBridgeClient);

// Mock PutEventsCommand – can be used to verify command construction
export const PutEventsCommand = vi.fn().mockImplementation((input) => ({
  // Return a command-like object; you can also store the input for later assertions
  input,
  // Optionally include a command name property
  constructor: { name: 'PutEventsCommand' },
}));

// If you use other commands, add them similarly:
// export const PutRuleCommand = vi.fn().mockImplementation((input) => ({ input, constructor: { name: 'PutRuleCommand' } }));
// export const PutTargetsCommand = vi.fn().mockImplementation((input) => ({ input, constructor: { name: 'PutTargetsCommand' } }));