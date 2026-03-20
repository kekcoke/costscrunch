import { describe, it, expect } from 'vitest';
import { withErrorHandler } from '../../../src/utils/withErrorHandler.js';
import { ValidationError, NotFoundError, CircuitOpenError } from '../../../src/utils/errors.js';
import { Context, APIGatewayProxyEventV2WithRequestContext, APIGatewayEventRequestContextV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

describe('withErrorHandler HOC', () => {
  const mockContext = { awsRequestId: 'test-req-id' } as Context;
  const mockEvent: APIGatewayProxyEventV2WithRequestContext<APIGatewayEventRequestContextV2> = {
    version: '2.0',
    routeKey: 'GET /test',
    rawPath: '/test',
    rawQueryString: '',
    headers: {},
    requestContext: {
      accountId: '123456789012',
      apiId: 'test-api',
      domainName: 'test.execute-api.us-east-1.amazonaws.com',
      domainPrefix: 'test',
      http: {
        method: 'GET',
        path: '/test',
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'vitest',
      },
      requestId: 'test-req-id',
      routeKey: 'GET /test',
      stage: 'test',
      time: new Date().toISOString(),
      timeEpoch: Date.now(),
    } as any,
    isBase64Encoded: false
  };

  it('returns 400 for ValidationError', async () => {
    const handler = async (_event: any) => { throw new ValidationError('Invalid input'); };
    const wrapped = withErrorHandler(handler);
    const result = (await wrapped(mockEvent, mockContext)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body || '{}')).toEqual({
      error: 'Invalid input',
      requestId: 'test-req-id'
    });
  });

  it('returns 404 for NotFoundError', async () => {
    const handler = async (_event: any) => { throw new NotFoundError('Not found'); };
    const wrapped = withErrorHandler(handler);
    const result = (await wrapped(mockEvent, mockContext)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body || '{}').error).toBe('Not found');
  });

  it('returns 503 for CircuitOpenError', async () => {
    const handler = async (_event: any) => { throw new CircuitOpenError('Service unavailable'); };
    const wrapped = withErrorHandler(handler);
    const result = (await wrapped(mockEvent, mockContext)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(503);
    expect(JSON.parse(result.body || '{}').error).toBe('Service unavailable');
  });

  it('returns 500 and hides message for unknown errors', async () => {
    const handler = async (_event: any) => { throw new Error('Database exploded'); };
    const wrapped = withErrorHandler(handler);
    const result = (await wrapped(mockEvent, mockContext)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body || '{}')).toEqual({
      error: 'Internal server error',
      requestId: 'test-req-id'
    });
  });
});
