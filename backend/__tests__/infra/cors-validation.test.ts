import { describe, it, expect } from 'vitest';
import axios from 'axios';

const API_URL = process.env.VITE_API_URL || 'http://localhost:3001';

// Full route registry — top-level + nested paths.
// Nested paths are critical: REST API v1 returns 404 if the resource isn't
// explicitly created in the Gateway tree. This test catches that class of bug.
const endpoints = [
  // Top-level
  '/groups',
  '/expenses',
  '/health',
  // Nested — groups
  '/groups/test-group-id',
  '/groups/test-group-id/balances',
  '/groups/test-group-id/members',
  '/groups/test-group-id/members/test-user-id',
  '/groups/test-group-id/settle',
  // Nested — expenses
  '/expenses/test-expense-id',
  // Nested — receipts
  '/receipts/upload-url',
  '/receipts/test-expense-id/scan',
  // Nested — analytics
  '/analytics/summary',
  '/analytics/trends',
  '/analytics/chart-data',
];

describe('CORS Policy Enforcement', () => {
  endpoints.forEach((path) => {
    describe(`Endpoint: ${path}`, () => {
      it('should return CORS headers for OPTIONS preflight', async () => {
        const response = await axios.options(`${API_URL}${path}`, {
          headers: {
            'Origin': 'http://localhost:3000',
            'Access-Control-Request-Method': 'GET',
          },
        });
        
        expect(response.headers['access-control-allow-origin']).toBe('*');
        expect(response.status).toBeLessThan(300);
      });

      it('should NOT return a bare 404 (missing Gateway resource)', async () => {
        try {
          await axios.get(`${API_URL}${path}`, {
            headers: { 'Origin': 'http://localhost:3000' },
          });
        } catch (error: any) {
          // A Gateway-level 404 has no CORS headers and body lacks structured error.
          // A Lambda response (401, 400, etc.) always has CORS headers from middleware.
          if (error.response?.status === 404) {
            const hasCors = !!error.response.headers['access-control-allow-origin'];
            expect(hasCors, `Bare 404 on ${path} — resource likely missing from Gateway`).toBe(true);
          }
          // Other statuses (401, 400, 500) are fine — Lambda processed the request
        }
      });

      it('should return CORS headers even on 401 Unauthorized', async () => {
        try {
          await axios.get(`${API_URL}${path}`, {
            headers: { 'Origin': 'http://localhost:3000' },
          });
        } catch (error: any) {
          if (error.response?.status === 401) {
            expect(error.response.headers['access-control-allow-origin']).toBe('*');
          }
        }
      });
    });
  });
});
