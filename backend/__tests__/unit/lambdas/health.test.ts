import { handler } from '../../../src/lambdas/health/index.js';
import { APIGatewayProxyEventV2 } from 'aws-lambda';

describe('Health Lambda', () => {
  it('returns 200 with correct body structure', async () => {
    process.env.STAGE = 'dev';
    const event = {} as APIGatewayProxyEventV2;
    const result = await handler(event) as any;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.status).toBe('ok');
    expect(body.stage).toBe('dev');
    expect(new Date(body.timestamp).getTime()).not.toBeNaN();
  });
});
