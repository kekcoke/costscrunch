import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildExpenseKeys, rawHandler, toResponse } from '../../src/lambdas/expenses/index.js';
import { QueryCommand, PutCommand, UpdateCommand, DeleteCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';

// Mock dependencies
vi.mock('../../src/utils/awsClients.js', () => ({
  createDynamoDBDocClient: vi.fn(() => ({
    send: vi.fn(),
  })),
}));

vi.mock('../../src/utils/withErrorHandler.js', () => ({
  withErrorHandler: (handler) => handler,
}));

import { createDynamoDBDocClient } from '../../src/utils/awsClients.js';

describe('Expenses Lambda - Group Support', () => {
  let mockSend: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSend = vi.fn().mockResolvedValue({});
    vi.clearAllMocks();
  });

  describe('buildExpenseKeys - Group Support', () => {
    it('should create keys with GROUP# prefix when groupId is provided', () => {
      const keys = buildExpenseKeys('user-123', 'exp-456', { 
        groupId: 'group-789',
        status: 'approved',
        date: '2024-01-01'
      });

      expect(keys.pk).toBe('GROUP#group-789');
      expect(keys.sk).toBe('EXPENSE#exp-456');
      expect(keys.gsi1pk).toBe('STATUS#approved');
      expect(keys.gsi1sk).toBe('DATE#2024-01-01#exp-456');
    });

    it('should create keys with USER# prefix when groupId is not provided', () => {
      const keys = buildExpenseKeys('user-123', 'exp-456', { 
        status: 'draft',
        date: '2024-01-01'
      });

      expect(keys.pk).toBe('USER#user-123');
      expect(keys.sk).toBe('EXPENSE#exp-456');
    });
  });

  describe('POST /expenses - Group Expenses', () => {
    it('should create expense with GROUP# prefix for group expenses', async () => {
      const mockEvent = {
        httpMethod: 'POST',
        path: '/expenses',
        body: JSON.stringify({
          amount: 100.00,
          currency: 'USD',
          category: 'meals',
          date: '2024-03-31',
          description: 'Team lunch',
          groupId: 'group-123',
        }),
      };

      mockSend.mockResolvedValueOnce({ Attributes: {} });

      await rawHandler(mockEvent);

      const putCommand = mockSend.mock.calls[0][0] as PutCommand;
      const item = putCommand.input.Item as any;

      expect(item.pk).toBe('GROUP#group-123');
      expect(item.sk).toBe('EXPENSE#');
      expect(item.groupId).toBe('group-123');
      expect(item.entityType).toBe('EXPENSE');
      expect(item.source).toBe('manual');
    });

    it('should create personal expense with USER# prefix when no groupId', async () => {
      const mockEvent = {
        httpMethod: 'POST',
        path: '/expenses',
        body: JSON.stringify({
          amount: 50.00,
          currency: 'USD',
          category: 'transport',
          date: '2024-03-31',
        }),
      };

      mockSend.mockResolvedValueOnce({ Attributes: {} });

      await rawHandler(mockEvent);

      const putCommand = mockSend.mock.calls[0][0] as PutCommand;
      const item = putCommand.input.Item as any;

      expect(item.pk).toBe('USER#');
      expect(item.groupId).toBeUndefined();
      expect(item.entityContext).toBe('PERSONAL');
    });
  });

  describe('GET /expenses - Group Expenses Query', () => {
    it('should query GROUP# prefix when groupId is provided', async () => {
      const mockEvent = {
        httpMethod: 'GET',
        path: '/expenses',
        queryStringParameters: {
          groupId: 'group-123',
          limit: '20',
        },
      };

      mockSend.mockResolvedValueOnce({
        Items: [],
        Count: 0,
        LastEvaluatedKey: undefined,
      });

      await rawHandler(mockEvent);

      const queryCommand = mockSend.mock.calls[0][0] as QueryCommand;
      expect(queryCommand.input.KeyConditionExpression).toBe('pk = :pk AND begins_with(sk, :prefix)');
      expect(queryCommand.input.ExpressionAttributeValues?.[':pk']).toBe('GROUP#group-123');
    });

    it('should query USER# prefix for personal expenses', async () => {
      const mockEvent = {
        httpMethod: 'GET',
        path: '/expenses',
        queryStringParameters: {
          limit: '20',
        },
      };

      mockSend.mockResolvedValueOnce({
        Items: [],
        Count: 0,
        LastEvaluatedKey: undefined,
      });

      await rawHandler(mockEvent);

      const queryCommand = mockSend.mock.calls[0][0] as QueryCommand;
      expect(queryCommand.input.ExpressionAttributeValues?.[':pk']).toBe('USER#');
    });
  });

  describe('ScanCommand Fallback', () => {
    it('should use ScanCommand as fallback when GetCommand fails', async () => {
      const mockEvent = {
        httpMethod: 'GET',
        path: '/expenses/expense-123',
      };

      // First call: GetCommand fails
      mockSend.mockRejectedValueOnce(new Error('ResourceNotFoundException'));
      // Second call: ScanCommand succeeds
      mockSend.mockResolvedValueOnce({
        Items: [{ pk: 'USER#', sk: 'EXPENSE#expense-123', expenseId: 'expense-123' }],
      });

      const result = await rawHandler(mockEvent);

      expect(result.statusCode).toBe(200);
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should return 404 when both GetCommand and ScanCommand fail', async () => {
      const mockEvent = {
        httpMethod: 'GET',
        path: '/expenses/nonexistent',
      };

      mockSend.mockRejectedValueOnce(new Error('ResourceNotFoundException'));
      mockSend.mockResolvedValueOnce({ Items: [] });

      const result = await rawHandler(mockEvent);

      expect(result.statusCode).toBe(404);
    });
  });

  describe('Export Functionality', () => {
    it('should reject PDF export with 501', async () => {
      const mockEvent = {
        httpMethod: 'GET',
        path: '/expenses/export',
        queryStringParameters: {
          format: 'pdf',
        },
      };

      const result = await rawHandler(mockEvent);

      expect(result.statusCode).toBe(501);
      expect(result.body).toContain('PDF Export not implemented');
    });

    it('should export to JSON when format=json', async () => {
      const mockEvent = {
        httpMethod: 'GET',
        path: '/expenses/export',
        queryStringParameters: {
          format: 'json',
          from: '2024-01-01',
          to: '2024-03-31',
        },
      };

      mockSend.mockResolvedValueOnce({
        Items: [
          { expenseId: 'exp-1', amount: 100, status: 'approved' },
        ],
        Count: 1,
      });

      const result = await rawHandler(mockEvent);

      expect(result.statusCode).toBe(200);
      expect(result.headers['Content-Type']).toBe('application/json');
    });

    it('should export to CSV when format=csv', async () => {
      const mockEvent = {
        httpMethod: 'GET',
        path: '/expenses/export',
        queryStringParameters: {
          format: 'csv',
          from: '2024-01-01',
        },
      };

      mockSend.mockResolvedValueOnce({
        Items: [
          { expenseId: 'exp-1', amount: 100, status: 'approved' },
        ],
        Count: 1,
      });

      const result = await rawHandler(mockEvent);

      expect(result.statusCode).toBe(200);
      expect(result.headers['Content-Type']).toBe('text/csv');
      expect(result.headers['Content-Disposition']).toContain('attachment');
    });
  });

  describe('Status-based Updates', () => {
    it('should set approvedAt and approverId when status=approved', async () => {
      const mockEvent = {
        httpMethod: 'PATCH',
        path: '/expenses/expense-123',
        body: JSON.stringify({
          status: 'approved',
        }),
      };

      mockSend.mockResolvedValueOnce({
        Items: [{ pk: 'USER#', sk: 'EXPENSE#expense-123', ownerId: 'user-123' }],
      });
      mockSend.mockResolvedValueOnce({
        Attributes: {
          approvedAt: '2024-03-31T12:00:00Z',
          approverId: 'user-123',
        },
      });

      const result = await rawHandler(mockEvent);

      expect(result.statusCode).toBe(200);
    });
  });

  describe('toResponse - ID Normalization', () => {
    it('should normalize expense with id field', () => {
      const item = { id: 'expense-123', expenseId: 'expense-123', amount: 100 };
      const normalized = toResponse(item);

      expect(normalized.id).toBe('expense-123');
      expect(normalized.expenseId).toBe('expense-123');
    });

    it('should normalize expense with expenseId field', () => {
      const item = { expenseId: 'expense-456', amount: 200 };
      const normalized = toResponse(item);

      expect(normalized.id).toBe('expense-456');
      expect(normalized.expenseId).toBe('expense-456');
    });

    it('should normalize expense with sk field', () => {
      const item = { sk: 'EXPENSE#expense-789', amount: 300 };
      const normalized = toResponse(item);

      expect(normalized.id).toBe('expense-789');
      expect(normalized.expenseId).toBe('expense-789');
    });
  });

  describe('Delete - Wrong Owner', () => {
    it('should handle delete with wrong owner gracefully', async () => {
      const mockEvent = {
        httpMethod: 'DELETE',
        path: '/expenses/expense-123',
      };

      mockSend.mockRejectedValueOnce(new Error('ConditionalCheckFailedException'));

      const result = await rawHandler(mockEvent);

      expect(result.statusCode).toBe(200);
      expect(result.body).toContain('not found or wrong owner');
    });
  });
});
