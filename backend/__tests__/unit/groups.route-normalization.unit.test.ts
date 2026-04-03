import { describe, it, expect } from 'vitest';
import { normalizeRoute } from '../../src/lambdas/groups/index.js';

describe('Groups Lambda - Route Normalization', () => {
  describe('normalizeRoute', () => {
    it('should normalize /groups/{id}/members route', () => {
      const result = normalizeRoute('GET', '/groups/g1/members', '$default GET /groups/g1/members');

      expect(result.route).toBe('GET /groups/{id}/members');
      expect(result.params.id).toBe('g1');
      expect(result.params.userId).toBeUndefined();
    });

    it('should normalize /groups/{id}/members/{userId} route', () => {
      const result = normalizeRoute('DELETE', '/groups/g1/members/u2', '$default DELETE /groups/g1/members/u2');

      expect(result.route).toBe('DELETE /groups/{id}/members/{userId}');
      expect(result.params.id).toBe('g1');
      expect(result.params.userId).toBe('u2');
    });

    it('should normalize /groups/{id}/balances route', () => {
      const result = normalizeRoute('GET', '/groups/g1/balances', '$default GET /groups/g1/balances');

      expect(result.route).toBe('GET /groups/{id}/balances');
      expect(result.params.id).toBe('g1');
    });

    it('should normalize /groups/{id}/settle route', () => {
      const result = normalizeRoute('POST', '/groups/g1/settle', '$default POST /groups/g1/settle');

      expect(result.route).toBe('POST /groups/{id}/settle');
      expect(result.params.id).toBe('g1');
    });

    it('should normalize /groups/{id} route', () => {
      const result = normalizeRoute('GET', '/groups/g1', '$default GET /groups/g1');

      expect(result.route).toBe('GET /groups/{id}');
      expect(result.params.id).toBe('g1');
    });

    it('should normalize /groups route', () => {
      const result = normalizeRoute('GET', '/groups', '$default GET /groups');

      expect(result.route).toBe('GET /groups');
      expect(result.params).toEqual({});
    });

    it('should handle routeKey with $default prefix', () => {
      const result = normalizeRoute('POST', '/groups/g1', '$default POST /groups/g1');

      expect(result.route).toBe('POST /groups/{id}');
      expect(result.params.id).toBe('g1');
    });

    it('should handle lowercase route keys', () => {
      const result = normalizeRoute('get', '/groups/g1', '$default get /groups/g1');

      expect(result.route).toBe('GET /groups/{id}');
      expect(result.params.id).toBe('g1');
    });

    it('should handle uppercase method from routeKey', () => {
      const result = normalizeRoute('', '/groups/g1', '$default POST /groups/g1');

      expect(result.route).toBe('POST /groups/{id}');
      expect(result.params.id).toBe('g1');
    });

    it('should preserve original route when no match', () => {
      const result = normalizeRoute('PATCH', '/unknown/route', '$default PATCH /unknown/route');

      expect(result.route).toBe('PATCH /unknown/route');
      expect(result.params).toEqual({});
    });

    it('should handle routes with trailing slash', () => {
      const result = normalizeRoute('GET', '/groups/g1/', '$default GET /groups/g1/');

      expect(result.route).toBe('GET /groups/{id}');
      expect(result.params.id).toBe('g1');
    });

    it('should handle empty path', () => {
      const result = normalizeRoute('GET', '', '$default GET');

      expect(result.route).toBe('GET');
      expect(result.params).toEqual({});
    });
  });
});
