import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context } from 'aws-lambda';
import { logger, setLogContext } from './logger.js';
import { ValidationError, NotFoundError, CircuitOpenError } from './errors.js';

export const withErrorHandler = (handler: (event: any, context: Context) => Promise<any>) => {
  return async (event: any, context: Context): Promise<APIGatewayProxyResultV2> => {
    const requestId = context?.awsRequestId || (event as any)?.headers?.['x-request-id'] || 'unknown';
    
    try {
      return await handler(event, context);
    } catch (error: any) {
      const statusCode = getStatusCode(error);
      const message = statusCode === 500 ? 'Internal server error' : error.message;

      logger.error(`Handler error: ${error.message}`, error);

      return {
        statusCode,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: message,
          requestId,
        }),
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
