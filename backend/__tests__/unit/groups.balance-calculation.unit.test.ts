import { describe, it, expect } from 'vitest';
import { calculateBalances, minimizeTransactions } from '../../src/lambdas/groups/index.js';

describe('Groups Lambda - Balance Calculation', () => {
  describe('calculateBalances', () => {
    it('should calculate balances correctly for approved expenses with splits', () => {
      const expenses = [
        {
          status: 'approved',
          ownerId: 'user-1',
          amount: 100,
          splits: [
            { userId: 'user-1', amount: 50 },
            { userId: 'user-2', amount: 50 },
          ],
        },
        {
          status: 'approved',
          ownerId: 'user-2',
          amount: 50,
          splits: [
            { userId: 'user-1', amount: 25 },
            { userId: 'user-2', amount: 25 },
          ],
        },
      ];

      const members = [
        { userId: 'user-1' },
        { userId: 'user-2' },
      ];

      const balances = calculateBalances(expenses, members as any);

      expect(balances['user-1']).toBe(25); // 50 (paid) - 75 (owed) = -25
      expect(balances['user-2']).toBe(25); // 75 (paid) - 50 (owed) = 25
    });

    it('should handle expenses without splits', () => {
      const expenses = [
        {
          status: 'approved',
          ownerId: 'user-1',
          amount: 100,
          splits: [],
        },
      ];

      const members = [
        { userId: 'user-1' },
        { userId: 'user-2' },
      ];

      const balances = calculateBalances(expenses, members as any);

      expect(balances['user-1']).toBe(100);
      expect(balances['user-2']).toBe(0);
    });

    it('should handle expenses with only one member', () => {
      const expenses = [
        {
          status: 'approved',
          ownerId: 'user-1',
          amount: 100,
          splits: [],
        },
      ];

      const members = [
        { userId: 'user-1' },
      ];

      const balances = calculateBalances(expenses, members as any);

      expect(balances['user-1']).toBe(100);
    });

    it('should ignore unapproved expenses', () => {
      const expenses = [
        {
          status: 'draft',
          ownerId: 'user-1',
          amount: 100,
          splits: [],
        },
        {
          status: 'approved',
          ownerId: 'user-1',
          amount: 50,
          splits: [],
        },
      ];

      const members = [
        { userId: 'user-1' },
      ];

      const balances = calculateBalances(expenses, members as any);

      expect(balances['user-1']).toBe(50); // Only approved expense counted
    });

    it('should handle zero balances', () => {
      const expenses = [
        {
          status: 'approved',
          ownerId: 'user-1',
          amount: 100,
          splits: [
            { userId: 'user-1', amount: 50 },
            { userId: 'user-2', amount: 50 },
          ],
        },
        {
          status: 'approved',
          ownerId: 'user-2',
          amount: 50,
          splits: [
            { userId: 'user-1', amount: 25 },
            { userId: 'user-2', amount: 25 },
          ],
        },
      ];

      const members = [
        { userId: 'user-1' },
        { userId: 'user-2' },
      ];

      const balances = calculateBalances(expenses, members as any);

      expect(balances['user-1']).toBe(0);
      expect(balances['user-2']).toBe(0);
    });

    it('should handle multiple transactions with rounding', () => {
      const expenses = [
        {
          status: 'approved',
          ownerId: 'user-1',
          amount: 100.55,
          splits: [
            { userId: 'user-1', amount: 33.52 },
            { userId: 'user-2', amount: 33.53 },
            { userId: 'user-3', amount: 33.50 },
          ],
        },
      ];

      const members = [
        { userId: 'user-1' },
        { userId: 'user-2' },
        { userId: 'user-3' },
      ];

      const balances = calculateBalances(expenses, members as any);

      // user-1 paid 33.52, owed 33.52 => balance 0
      // user-2 paid 33.53, owed 33.53 => balance 0
      // user-3 paid 33.50, owed 33.53 => balance -0.03
      expect(balances['user-1']).toBeCloseTo(0, 2);
      expect(balances['user-2']).toBeCloseTo(0, 2);
      expect(balances['user-3']).toBeCloseTo(-0.03, 2);
    });
  });

  describe('minimizeTransactions', () => {
    it('should reduce N*(N-1)/2 transactions to at most N-1', () => {
      const balances: Record<string, number> = {
        'user-1': 50,
        'user-2': -30,
        'user-3': -20,
        'user-4': 0,
      };

      const transactions = minimizeTransactions(balances);

      expect(transactions.length).toBeLessThanOrEqual(3); // N-1 = 3
    });

    it('should handle single transaction', () => {
      const balances: Record<string, number> = {
        'user-1': 100,
        'user-2': -100,
      };

      const transactions = minimizeTransactions(balances);

      expect(transactions.length).toBe(1);
      expect(transactions[0]).toEqual({
        from: 'user-2',
        to: 'user-1',
        amount: 100,
      });
    });

    it('should handle no transactions when all balanced', () => {
      const balances: Record<string, number> = {
        'user-1': 0,
        'user-2': 0,
        'user-3': 0,
      };

      const transactions = minimizeTransactions(balances);

      expect(transactions.length).toBe(0);
    });

    it('should handle multiple transactions with varying amounts', () => {
      const balances: Record<string, number> = {
        'user-1': 150,
        'user-2': -50,
        'user-3': -100,
      };

      const transactions = minimizeTransactions(balances);

      expect(transactions.length).toBe(2);
      expect(transactions.some(t => t.from === 'user-2')).toBe(true);
      expect(transactions.some(t => t.from === 'user-3')).toBe(true);
      expect(transactions.some(t => t.to === 'user-1')).toBe(true);
    });

    it('should round transactions to 2 decimal places', () => {
      const balances: Record<string, number> = {
        'user-1': 99.99,
        'user-2': -50.50,
        'user-3': -49.49,
      };

      const transactions = minimizeTransactions(balances);

      transactions.forEach(t => {
        expect(t.amount).toBeCloseTo(Math.round(t.amount * 100) / 100, 2);
      });
    });

    it('should ignore negligible balances', () => {
      const balances: Record<string, number> = {
        'user-1': 0.005,
        'user-2': -0.005,
      };

      const transactions = minimizeTransactions(balances);

      expect(transactions.length).toBe(0);
    });
  });
});
