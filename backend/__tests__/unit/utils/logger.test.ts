import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger, setLogContext, clearLogContext } from '../../../src/utils/logger';

describe('Logger Utility', () => {
  let spy: any;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-19T12:00:00Z'));
    clearLogContext();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('outputs valid JSON with required fields', () => {
    spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    setLogContext({ requestId: 'req-123', userId: 'user-456', route: 'GET /test' });
    
    logger.info('Test message');

    const output = JSON.parse(spy.mock.calls[0][0]);
    expect(output).toEqual({
      timestamp: '2026-03-19T12:00:00.000Z',
      level: 'INFO',
      requestId: 'req-123',
      userId: 'user-456',
      route: 'GET /test',
      message: 'Test message'
    });
  });

  it('includes error details and stack trace', () => {
    spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const testError = new Error('Boom');
    
    logger.error('Failed operation', testError);

    const output = JSON.parse(spy.mock.calls[0][0]);
    expect(output.level).toBe('ERROR');
    expect(output.message).toBe('Failed operation');
    expect(output.error.message).toBe('Boom');
    expect(output.error.stack).toBeDefined();
  });
});
