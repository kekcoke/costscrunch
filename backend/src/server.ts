import express, { Request, Response } from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';

import { handler as expensesHandler } from '../lambdas/expenses/index';
import { handler as groupsHandler } from '../lambdas/groups/index';
import { handler as receiptsHandler } from '../lambdas/receipts/index';
import { handler as analyticsHandler } from '../lambdas/analytics/index';

const app = express();
const PORT = process.env.PORT || 4000;

// Environment
process.env.TABLE_NAME = 'CostCrunchTable';
process.env.RECEIPTS_BUCKET = 'costcrunch-receipts';
process.env.ENVIRONMENT = 'dev';
process.env.LOG_LEVEL = 'debug';

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Startup
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}. Environment: ${process.env.ENVIRONMENT}    `);
});