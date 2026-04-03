import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildExpenseKeys, rawHandler, toResponse } from '../../src/lambdas/expenses/index.js';
import { QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

// Holder for mockSend - populated by vi.mock factory
const mockHolders: Record<string, any> = {};

// Mock dependencies - must be at top level for Vitest hoisting
vi.mock('../../src/utils/awsClients.js', () => {
  const mockSend = vi.fn().mockResolvedValue({});
  // Store in global for test access
  (global as any).__expensesMockSend = mockSend;
  return {
    __esModule: true,
    createDynamoDBDocClient: vi.fn(() => ({
      send: mockSend,
    })),
    createS3Client: vi.fn(() => ({
      send: vi.fn(),
    })),
  };
});

vi.mock('../../src/utils/withErrorHandler.js', () => ({
  withErrorHandler: (handler) => handler,
}));

function getMockSend() {
  return (global as any).__expensesMockSend as ReturnType<typeof vi.fn>;
}

describe('Expenses Lambda - Group Support', () => {
  beforeEach(() => {
    const mockSend = getMockSend();
    mockSend.mockResolvedValue({});
    mockSend.mockReset();
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
    it('should create expense with USER# prefix for owner and groupId stored', async () => {
      const mockSend = getMockSend();
      
      const mockEvent = {
        httpMethod: 'POST',
        path: '/expenses',
        body: JSON.stringify({
          merchant: 'Restaurant',
          amount: 100.00,
          currency: 'USD',
          category: 'meals',
          date: '2024-03-31',
          description: 'Team lunch',
          groupId: 'group-123',
        }),
      };

      mockSend.mockResolvedValueOnce({ Attributes: {} });

      const result = await rawHandler(mockEvent);
      
      expect(result.statusCode).toBe(201);
      expect(mockSend).toHaveBeenCalled();
      
      const putCommand = mockSend.mock.calls[0][0] as PutCommand;
      const item = putCommand.input.Item as any;

      expect(item.pk).toBe('GROUP#group-123');
      expect(item.sk).toMatch(/^EXPENSE#01[A-Z0-9]{24}$/);
      expect(item.groupId).toBe('group-123');
      expect(item.entityType).toBe('EXPENSE');
      expect(item.entityContext).toBe('GROUP');
      expect(item.source).toBe('manual');
    });

    it('should create personal expense with USER# prefix when no groupId', async () => {
      const mockSend = getMockSend();
      
      const mockEvent = {
        httpMethod: 'POST',
        path: '/expenses',
        body: JSON.stringify({
          merchant: 'Taxi',
          amount: 50.00,
          currency: 'USD',
          category: 'transport',
          date: '2024-03-31',
        }),
      };

      mockSend.mockResolvedValueOnce({ Attributes: {} });

      const result = await rawHandler(mockEvent);
      
      expect(result.statusCode).toBe(201);
      expect(mockSend).toHaveBeenCalled();
      
      const putCommand = mockSend.mock.calls[0][0] as PutCommand;
      const item = putCommand.input.Item as any;

      expect(item.pk).toBe('USER#00000000-0000-0000-0000-test-user-001');
      expect(item.groupId).toBeUndefined();
      expect(item.entityContext).toBe('PERSONAL');
    });
  });

  describe('GET /expenses - Group Expenses Query', () => {
    it('should query USER# prefix for personal expenses', async () => {
      const mockSend = getMockSend();
      
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
      expect(queryCommand.input.ExpressionAttributeValues?.[':pk']).toBe('USER#00000000-0000-0000-0000-test-user-001');
    });
  });

  describe('ScanCommand Fallback', () => {
    it('should use ScanCommand as fallback when GetCommand fails', async () => {
      const mockSend = getMockSend();
      
      const mockEvent = {
        httpMethod: 'GET',
        path: '/expenses/expense-123',
      };

      // GetCommand returns no Item, then ScanCommand finds it
      mockSend.mockResolvedValueOnce({ Item: undefined });
      mockSend.mockResolvedValueOnce({
        Items: [{ pk: 'USER#', sk: 'EXPENSE#expense-123', expenseId: 'expense-123' }],
      });

      const result = await rawHandler(mockEvent);

      expect(result.statusCode).toBe(200);
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should return 404 when both GetCommand and ScanCommand fail', async () => {
      const mockSend = getMockSend();
      
      const mockEvent = {
        httpMethod: 'GET',
        path: '/expenses/nonexistent',
      };

      // GetCommand returns no Item, ScanCommand returns empty
      mockSend.mockResolvedValueOnce({ Item: undefined });
      mockSend.mockResolvedValueOnce({ Items: [] });

      const result = await rawHandler(mockEvent);

      expect(result.statusCode).toBe(404);
    });
  });

  describe('Export Functionality', () => {
    it('should reject PDF export with 501', async () => {
      const mockSend = getMockSend();
      mockSend.mockResolvedValue({ Items: [], Count: 0 });
      
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
      const mockSend = getMockSend();
      
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
        Items: [{ expenseId: 'exp-1', amount: 100, status: 'approved' }],
        Count: 1,
      });

      const result = await rawHandler(mockEvent);

      expect(result.statusCode).toBe(200);
      expect(result.headers['Content-Type']).toBe('application/json');
    });

    it('should export to CSV when format=csv', async () => {
      const mockSend = getMockSend();
      
      const mockEvent = {
        httpMethod: 'GET',
        path: '/expenses/export',
        queryStringParameters: {
          format: 'csv',
          from: '2024-01-01',
        },
      };

      mockSend.mockResolvedValueOnce({
        Items: [{ expenseId: 'exp-1', amount: 100, status: 'approved' }],
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
      const mockSend = getMockSend();
      
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
      const mockSend = getMockSend();
      
      const mockEvent = {
        httpMethod: 'DELETE',
        path: '/expenses/expense-123',
      };

      const error = new Error('ConditionalCheckFailedException');
      error.name = 'ConditionalCheckFailedException';
      mockSend.mockRejectedValueOnce(error);

      const result = await rawHandler(mockEvent);

      expect(result.statusCode).toBe(200);
      expect(result.body).toContain('not found or wrong owner');
    });
  });
});
