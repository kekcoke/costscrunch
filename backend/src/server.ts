import express, { Request, Response } from 'express';
import cors, { CorsOptions } from 'cors';
import bodyParser from 'body-parser';
import { rawHandler as expensesHandler } from './lambdas/expenses/index.js';
import { handler as groupsHandler } from './lambdas/groups/index.js';
import { handler as analyticsHandler } from './lambdas/analytics/index.js';
import { handler as receiptsHandler } from './lambdas/receipts/index.js';
import { ulid } from 'ulid';

export const app = express();
const PORT = process.env.PORT || 4000;

// ── CORS — single source of truth for local dev (mirrors CDK CORS_CONFIG) ─────
// Production: CloudFront ResponseHeadersPolicy handles CORS.
// SAM local: template-arm.yaml Globals.Api.Cors handles CORS.
// Express local (this file): handles CORS via middleware.
const CORS_CONFIG: CorsOptions & {
  methods: string[];
  allowedHeaders: string[];
} = {
  origin: "*",
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Idempotency-Key"],
  exposedHeaders: ["Content-Disposition"],
  maxAge: 86400,
};

app.use(cors(CORS_CONFIG));
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
      
      const contentType = result.headers?.["Content-Type"] || result.headers?.["content-type"] || "application/json";
      let responseBody;

      if (contentType.includes("application/json") && typeof result.body === "string") {
        try {
          responseBody = JSON.parse(result.body);
        } catch (e) {
          responseBody = result.body;
        }
      } else {
        responseBody = result.body;
      }
      
      // Strip CORS headers from Lambda response — let Express middleware be the authority
      const { "Access-Control-Allow-Origin": _,
              "Access-Control-Allow-Methods": __,
              "Access-Control-Allow-Headers": ___,
              "Access-Control-Allow-Credentials": ____,
              "Access-Control-Expose-Headers": _____,
              "Access-Control-Max-Age": ______,
              ...safeHeaders
      } = result.headers || {};

      res.status(result.statusCode || 200)
         .set(safeHeaders);

      // Ensure CORS headers are present on actual requests (mirroring CF policy)
      if (req.headers.origin) {
        res.setHeader("Access-Control-Allow-Methods", CORS_CONFIG.methods.join(", "));
        res.setHeader("Access-Control-Allow-Headers", CORS_CONFIG.allowedHeaders.join(", "));
      }

      if (typeof responseBody === "string" && !contentType.includes("application/json")) {
        res.send(responseBody);
      } else {
        res.json(responseBody);
      }
    } catch (error: any) {
      console.error(`[Local Server Error - ${requestId}]:`, error);
      res.status(500).json({ error: "Internal Server Error", message: error.message });
    }
  };

// Routes

// Routers - Analytics
app.get('/analytics/summary', lambdaAdapter(analyticsHandler, 'GET /analytics/summary'));
app.get('/analytics/trends', lambdaAdapter(analyticsHandler, 'GET /analytics/trends'));
app.get('/analytics/chart-data', lambdaAdapter(analyticsHandler, 'GET /analytics/chart-data'));

// Routes - Expenses
app.get('/expenses', lambdaAdapter(expensesHandler, '/expenses'));
app.get('/expenses/export', lambdaAdapter(expensesHandler, '/expenses/export'));
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

// Routes - Receipts
app.post('/receipts/upload-url', lambdaAdapter(receiptsHandler, '/receipts/upload-url'));
app.get('/receipts/:expenseId/scan', lambdaAdapter(receiptsHandler, '/receipts/{expenseId}/scan'));
app.get('/receipts/:expenseId/download', lambdaAdapter(receiptsHandler, '/receipts/{expenseId}/download'));

// Startup
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}. Environment: ${process.env.ENVIRONMENT}    `);
});