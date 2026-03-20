import {
  APIGatewayProxyStructuredResultV2,
  Context,
} from 'aws-lambda';
import { logger } from './logger.js';
import { ValidationError, NotFoundError, CircuitOpenError } from './errors.js';

/**
 * Universal Lambda Handler type.
 */
type AnyHandler = (
  event: any,
  context: Context,
  ...rest: any[]
) => any;

/**
 * Higher-Order Function that wraps Lambda handlers with a global try/catch block.
 * Maps known error types to HTTP status codes and ensures structured logging.
 * 
 * Uses Awaited and ReturnType to preserve the original handler's return type 
 * while adding the API Gateway error response shape.
 */
export const withErrorHandler = <T extends AnyHandler>(
  handler: T
): (
  event: Parameters<T>[0],
  context?: Context,
  ...rest: any[]
) => Promise<Awaited<ReturnType<T>> | APIGatewayProxyStructuredResultV2> => {
  return async (event: Parameters<T>[0], context?: Context, ...rest: any[]) => {
    const requestId =
      context?.awsRequestId ||
      (event && typeof event === 'object' && 'headers' in event ? (event as Record<string, any>).headers?.['x-request-id'] : undefined) ||
      'unknown';

    try {
      // Pass through context and rest parameters (like callback) if provided
      return await handler(event, context as Context, ...rest);
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      const statusCode = getStatusCode(err);
      const message = statusCode === 500 ? 'Internal server error' : err.message;

      logger.error(`Handler error: ${err.message}`, err);

      return {
        statusCode,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: message, requestId }),
      };
    }
  };
};

const getStatusCode = (error: Error): number => {
  if (error instanceof ValidationError) return 400;
  if (error instanceof NotFoundError) return 404;
  if (error instanceof CircuitOpenError) return 503;
  return 500;
};
