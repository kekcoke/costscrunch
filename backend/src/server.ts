import express, { Request, Response } from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { rawHandler as expensesHandler } from './lambdas/expenses/index.js';
import { handler as groupsHandler } from './lambdas/groups/index.js';
import { handler as analyticsHandler } from './lambdas/analytics/index.js';
import { ulid } from 'ulid';

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Lambda adapter for API Gateway V2 Proxy Events and Middleware
const lambdaAdapter = (handler: any, routeKeyPattern: string) => 
  async (req: Request, res: Response) => {
    const requestId = ulid();
    
    // Construct the event object to match what API Gateway V2 sends to Lambda
    const event = {
      version: "2.0",
      routeKey: `${req.method} ${routeKeyPattern}`,
      rawPath: req.path,
      headers: {
        ...req.headers,
        "x-request-id": requestId,
      },
      queryStringParameters: Object.keys(req.query).length ? req.query : undefined,
      pathParameters: req.params,
      body: JSON.stringify(req.body),
      isBase64Encoded: false,
      requestContext: {
        http: {
          method: req.method,
          path: req.path,
        },
        authorizer: {
          jwt: {
            claims: {
              sub: "local-user-uuid-123", // Simulated Cognito sub
              email: "dev-user@example.com",
              "cognito:groups": "pro,admins", // Aligned with getAuth() logic
            }
          }
        },
        requestId,
      }
    };

    try {
      // Invoke the actual handler exported from your Lambda index.ts
      const result = await handler(event, { awsRequestId: requestId });
      
      const responseBody = typeof result.body === 'string' ? JSON.parse(result.body) : result.body;
      
      res.status(result.statusCode || 200)
         .set(result.headers || {})
         .json(responseBody);
    } catch (error: any) {
      console.error(`[Local Server Error - ${requestId}]:`, error);
      res.status(500).json({ error: "Internal Server Error", message: error.message });
    }
  };

// Routes

// Routers - Analytics
app.get('/analytics/summary', lambdaAdapter(analyticsHandler, 'GET /analytics/summary'));
app.get('/analytics/trends', lambdaAdapter(analyticsHandler, 'GET /analytics/trends'));
app.get('/analytics/chartData', lambdaAdapter(analyticsHandler,'GET /analytics/chartData' ));

// Routes - Expenses
app.get('/expenses', lambdaAdapter(expensesHandler, '/expenses'));
app.post('/expenses', lambdaAdapter(expensesHandler, '/expenses'));
app.get('/expenses/:id', lambdaAdapter(expensesHandler, '/{id}'));
app.patch('/expenses/:id', lambdaAdapter(expensesHandler, '/{id}'));
app.delete('/expenses/:id', lambdaAdapter(expensesHandler, '/{id}'));


// Routes - Groups
app.get('/groups', lambdaAdapter(groupsHandler, '/groups'));
app.post('/groups', lambdaAdapter(groupsHandler, '/groups'));
app.get('/groups/:id', lambdaAdapter(groupsHandler, '/groups/{id}'));
app.patch('/groups/:id', lambdaAdapter(groupsHandler, '/groups/{id}'));
app.delete('/groups/:id', lambdaAdapter(groupsHandler, '/groups/{id}'));
app.get('/groups/:id/balances', lambdaAdapter(groupsHandler, '/groups/{id}/balances'));
app.post('/groups/:id/members', lambdaAdapter(groupsHandler, '/groups/{id}/members'));
app.delete('/groups/:id/members/:userId', lambdaAdapter(groupsHandler, '/groups/{id}/members/{userId}'));
app.post('/groups/:id/settle', lambdaAdapter(groupsHandler, '/groups/{id}/settle'));

// Startup
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}. Environment: ${process.env.ENVIRONMENT}    `);
});