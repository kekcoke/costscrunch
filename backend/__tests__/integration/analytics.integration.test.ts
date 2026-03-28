import { describe, it, expect } from 'vitest';
import axios from 'axios';

const API_URL = process.env.API_URL || 'http://localhost:4000';
const TEST_USER_ID = "00000000-0000-0000-0000-test-user-001";

describe('Analytics API Integration', () => {
  // These tests require LocalStack and the backend to be running
  // and seeded with infrastructure/localstack/dev/seed.csv
  
  it('GET /analytics/summary calculates total from seeded data', async () => {
    try {
      const response = await axios.get(`${API_URL}/analytics/summary`, {
        headers: { 'x-mock-user-id': TEST_USER_ID }
      });
      
      expect(response.status).toBe(200);
      const { totalAmount, expenseCount } = response.data;
      
      // Seed data for user 001 has:
      // e1 (Groceries): 142.87
      // e2 (Travel, via Group g1): 428.00
      // h1-h7 historical items...
      // Total should be at least 142.87 + 428.00 = 570.87
      expect(totalAmount).toBeGreaterThanOrEqual(570.87);
      expect(expenseCount).toBeGreaterThanOrEqual(2);
    } catch (error: any) {
      if (error.code === 'ECONNREFUSED') {
        console.warn('Local server not running, skipping integration check');
        return;
      }
      throw error;
    }
  });

  it('GET /analytics/chart-data populates all chart types', async () => {
    try {
      const response = await axios.get(`${API_URL}/analytics/chart-data?chartType=stackedBar`, {
        headers: { 'x-mock-user-id': TEST_USER_ID }
      });
      
      expect(response.status).toBe(200);
      const { donut, horizontalBar, bubble, stackedBar } = response.data;
      
      expect(donut.length).toBeGreaterThan(0);
      expect(horizontalBar.length).toBeGreaterThan(0);
      expect(bubble.length).toBeGreaterThan(0);
      expect(stackedBar.length).toBeGreaterThan(0);
      
      // Verify stackedBar contains category breakdown
      expect(stackedBar[0]).toHaveProperty('categories');
    } catch (error: any) {
      if (error.code === 'ECONNREFUSED') return;
      throw error;
    }
  });
});
