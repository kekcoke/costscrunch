// __mocks__/@aws-sdk/client-eventbridge.ts
import { vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const mockEventBridgeSend = vi.fn().mockResolvedValue({});
  const EventBridgeClient = vi.fn().mockImplementation(() => ({
    send: mockEventBridgeSend,
  }));
  const PutEventsCommand = vi.fn().mockImplementation((input) => input);

  return { mockEventBridgeSend, EventBridgeClient, PutEventsCommand };
});

export const mockEventBridgeSend = hoisted.mockEventBridgeSend;
export const EventBridgeClient = hoisted.EventBridgeClient;
export const PutEventsCommand = hoisted.PutEventsCommand;

vi.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: hoisted.EventBridgeClient,
  PutEventsCommand: hoisted.PutEventsCommand,
}));