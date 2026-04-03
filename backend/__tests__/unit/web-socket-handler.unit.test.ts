import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PutCommand } from '@aws-sdk/lib-dynamodb';

// Use vi.hoisted so mocks are available when vi.mock factories run (hoisting)
const { mockSend, mockGetAuth } = vi.hoisted(() => ({
  mockSend: vi.fn().mockResolvedValue({}),
  mockGetAuth: vi.fn(),
}));

vi.mock('../../src/utils/awsClients.js', () => ({
  createDynamoDBDocClient: vi.fn(() => ({
    send: mockSend,
  })),
}));

vi.mock('../../src/utils/withErrorHandler.js', () => ({
  withErrorHandler: (handler) => handler,
}));

vi.mock('../../src/utils/auth.js', () => ({
  getAuth: mockGetAuth,
}));

import { rawHandler } from '../../src/lambdas/web-socket-handler/index.js';

describe('WebSocket Handler', () => {
  beforeEach(() => {
    process.env.TABLE_NAME_CONNECTIONS = 'test-connections-table';
    process.env.MOCK_AUTH = 'true';
    mockSend.mockReset().mockResolvedValue({});
    mockGetAuth.mockReset();
  });

  describe('$connect', () => {
    it('should connect and store connection with valid auth', async () => {
      const mockEvent = {
        requestContext: {
          routeKey: '$connect',
          connectionId: 'conn-123',
        },
        queryStringParameters: { userId: 'user-123' },
      };

      mockGetAuth.mockReturnValue({ userId: 'user-123' });

      const result = await rawHandler(mockEvent);

      expect(result.statusCode).toBe(200);
      expect(mockSend).toHaveBeenCalledTimes(1);
      const putCommand = mockSend.mock.calls[0][0] as PutCommand;
      expect(putCommand.input.TableName).toBe('test-connections-table');
      expect(putCommand.input.Item).toMatchObject({
        pk: 'WS_CONN#user-123',
        sk: 'CONN#conn-123',
        connectionId: 'conn-123',
        userId: 'user-123',
      });
    });

    it('should handle local dev auth with local-user-uuid-123', async () => {
      const mockEvent = {
        requestContext: {
          routeKey: '$connect',
          connectionId: 'conn-456',
        },
        queryStringParameters: { userId: 'local-user-uuid-123' },
      };

      mockGetAuth.mockReturnValue({ userId: 'local-user-uuid-123' });

      const result = await rawHandler(mockEvent);

      expect(result.statusCode).toBe(200);
      expect(mockSend).toHaveBeenCalledTimes(1);
      const putCommand = mockSend.mock.calls[0][0] as PutCommand;
      expect(putCommand.input.TableName).toBe('test-connections-table');
      expect(putCommand.input.Item).toMatchObject({
        pk: 'WS_CONN#local-user-uuid-123',
        sk: 'CONN#conn-456',
        connectionId: 'conn-456',
        userId: 'local-user-uuid-123',
      });
    });

    it('should handle missing auth token gracefully', async () => {
      const mockEvent = {
        requestContext: {
          routeKey: '$connect',
          connectionId: 'conn-789',
        },
      };

      mockGetAuth.mockImplementation(() => {
        throw new Error('Unauthorized');
      });

      const result = await rawHandler(mockEvent);

      // With MOCK_AUTH=true, missing auth is treated as local user
      expect(result.statusCode).toBe(200);
      expect(mockSend).toHaveBeenCalledTimes(1);
      const putCommand = mockSend.mock.calls[0][0] as PutCommand;
      expect(putCommand.input.TableName).toBe('test-connections-table');
      expect(putCommand.input.Item).toMatchObject({
        pk: 'WS_CONN#local-user',
        sk: 'CONN#conn-789',
        connectionId: 'conn-789',
        userId: 'local-user',
      });
    });

    it('should store connection with TTL set to 8 hours', async () => {
      const mockEvent = {
        requestContext: {
          routeKey: '$connect',
          connectionId: 'conn-ttl',
        },
        queryStringParameters: { userId: 'user-ttl' },
      };

      mockGetAuth.mockReturnValue({ userId: 'user-ttl' });

      await rawHandler(mockEvent);

      const putCommand = mockSend.mock.calls[0][0] as PutCommand;
      const item = putCommand.input.Item as any;
      const ttl = item.ttl;
      const expectedTTL = Math.floor(Date.now() / 1000) + (8 * 60 * 60);

      expect(ttl).toBeGreaterThanOrEqual(expectedTTL);
      expect(ttl).toBeLessThanOrEqual(expectedTTL + 60);
      expect(item.pk).toBe('WS_CONN#user-ttl');
      expect(item.sk).toBe('CONN#conn-ttl');
    });
  });

  describe('$disconnect', () => {
    it('should handle disconnect gracefully', async () => {
      const mockEvent = {
        requestContext: {
          routeKey: '$disconnect',
          connectionId: 'conn-disconnect',
        },
      };

      const result = await rawHandler(mockEvent);

      expect(result.statusCode).toBe(200);
      expect(result.body).toBe('Disconnected');
    });
  });

  describe('unknown routes', () => {
    it('should return 400 for unknown route keys', async () => {
      const mockEvent = {
        requestContext: {
          routeKey: '$unknown',
          connectionId: 'conn-unknown',
        },
      };

      const result = await rawHandler(mockEvent);

      expect(result.statusCode).toBe(400);
      expect(result.body).toBe('Unknown route');
    });
  });

  describe('connection table', () => {
    it('should use correct connection table name from environment', async () => {
      const mockEvent = {
        requestContext: {
          routeKey: '$connect',
          connectionId: 'conn-env',
        },
        queryStringParameters: { userId: 'user-env' },
      };

      mockGetAuth.mockReturnValue({ userId: 'user-env' });

      await rawHandler(mockEvent);

      const putCommand = mockSend.mock.calls[0][0] as PutCommand;
      expect(putCommand.input.TableName).toBe('test-connections-table');
    });
  });
});
