import { describe, it, expect } from 'vitest';
import axios from 'axios';

const API_URL = process.env.VITE_API_URL || 'http://localhost:3001';

describe('CORS Policy Enforcement', () => {
  const endpoints = ['/groups', '/expenses', '/health'];

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

      it('should return CORS headers even on 401 Unauthorized', async () => {
        try {
          await axios.get(`${API_URL}${path}`, {
            headers: { 'Origin': 'http://localhost:3000' },
          });
        } catch (error: any) {
          expect(error.response.status).toBe(401);
          expect(error.response.headers['access-control-allow-origin']).toBe('*');
        }
      });

      it('should return CORS headers for successful GET', async () => {
        // Using mock auth header if needed
        const response = await axios.get(`${API_URL}${path}`, {
          headers: { 
            'Origin': 'http://localhost:3000',
            'Authorization': 'Bearer mock-token'
          },
        });
        expect(response.headers['access-control-allow-origin']).toBe('*');
      });
    });
  });
});
