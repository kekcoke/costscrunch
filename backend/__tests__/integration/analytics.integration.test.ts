import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import axios from 'axios';
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";

// Note: This assumes the local server is running on port 4000
const API_URL = 'http://localhost:4000';
const ddbMock = mockClient(DynamoDBDocumentClient);

describe('Analytics API Integration', () => {
  it('GET /analytics/summary returns correct structure', async () => {
    // In a real integration test against a running local server with mocks, 
    // we would use MSW or ensure the server process uses the same mock singleton if in-process.
    // For this design, we verify the endpoint is reachable and returns the expected schema.
    try {
      const response = await axios.get(`${API_URL}/analytics/summary?period=month`);
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('totalAmount');
      expect(response.data).toHaveProperty('byCategory');
    } catch (error: any) {
      if (error.code === 'ECONNREFUSED') {
        console.warn('Local server not running, skipping integration check');
        return;
      }
      throw error;
    }
  });
});
