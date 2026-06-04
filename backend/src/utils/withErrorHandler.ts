import {
  APIGatewayProxyStructuredResultV2,
  Context,
} from 'aws-lambda';
import { logger } from './logger.js';
import { ValidationError, NotFoundError, CircuitOpenError } from './errors.js';

export const withErrorHandler = <E, R>(
  handler: (event: E, context: Context) => Promise<R>
) => async (event: E, context: Context): Promise<R | APIGatewayProxyStructuredResultV2> => {
    const requestId =
      (context as any)?.awsRequestId ||
      (event && typeof event === 'object' && 'headers' in event ? (event as Record<string, any>).headers?.['x-request-id'] : undefined) ||
      'unknown';

    const CORS_HEADERS = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Credentials': 'true',
    };

    try {
      const result = await handler(event, context);

      if (result && typeof result === 'object' && 'statusCode' in result) {
        (result as Record<string, any>).headers = { ...CORS_HEADERS, ...(result as Record<string, any>).headers };
      }

      return result;
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      const statusCode = getStatusCode(err);
      const message = (statusCode === 500 && !process.env.DEBUG_ERRORS) ? 'Internal server error' : err.message;

      logger.error(`Handler error: ${err.message}`, err);

      return {
        statusCode,
        headers: { 
          'Content-Type': 'application/json',
          ...CORS_HEADERS,
        },
        body: JSON.stringify({ error: message, requestId }),
      };
    }
};

const getStatusCode = (error: Error): number => {
  if (error instanceof ValidationError) return 400;
  if (error instanceof NotFoundError) return 404;
  if (error instanceof CircuitOpenError) return 503;
  return 500;
};
