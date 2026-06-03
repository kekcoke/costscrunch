# CostsCrunch — add-lambda-endpoint.md
## Skill: Add a Lambda Endpoint

> Used by: backend-agent, infra-agent
> After adding the endpoint, register the route in CDK: `ai/agents/infra-agent.md §3 IaC-006`

---

## 1. Context to Load First

```
ai/system/system-prompt.md §3   — DynamoDB key patterns
ai/system/system-prompt.md §4   — Lambda handler contract
```

Key facts:
- All IDs are ULIDs — use `ulid` package, never Math.random or UUID
- `getAuth(event).userId` is the only valid identity source — never read from request body
- Validate all inputs with Zod before touching business logic
- Use `@aws-lambda-powertools/logger` — never `console.log`
- Return `ok()` / `err()` helpers — they include CORS headers

---

## 2. Handler Pattern

```typescript
import { withErrorHandler } from '@src/utils/errorHandler';
import { getAuth } from '@src/helpers/auth';
import { ok, err } from '@src/utils/response';
import { logger } from '@aws-lambda-powertools/logger';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';

const BodySchema = z.object({
  amount: z.number().positive(),
  category: z.string().min(1),
  // ...
});

export const handler = withErrorHandler(async (event, _context) => {
  const { userId } = getAuth(event);                         // throws 401 if missing
  const body = BodySchema.parse(JSON.parse(event.body ?? '{}')); // throws 400 if invalid

  logger.info('Creating expense', { userId });               // never log amounts/PII in prod

  await client.send(new PutCommand({
    TableName: process.env.TABLE_NAME_MAIN!,
    Item: {
      pk: `USER#${userId}`,
      sk: `EXPENSE#${ulid()}`,
      gsi1pk: `STATUS#pending`,
      gsi1sk: `DATE#${new Date().toISOString()}#${id}`,
      gsi2pk: `CATEGORY#${body.category}`,
      gsi2sk: `DATE#${new Date().toISOString()}#${id}`,
      ...body,
    },
  }));

  return ok({ expenseId: id });
});
```

---

## 3. Routing (Dual-Mode: REST v1 + HTTP v2)

Lambda handlers use `resolveRoute(event)` to work in both LocalStack REST v1 and production HTTP v2:

```typescript
import { resolveRoute } from '@src/utils/router';

export const handler = withErrorHandler(async (event, context) => {
  const route = resolveRoute(event);   // returns "GET /expenses/:id" etc.

  if (route === 'POST /expenses') return createExpense(event);
  if (route.startsWith('GET /expenses/')) return getExpense(event);
  if (route.startsWith('PATCH /expenses/')) return updateExpense(event);
  if (route === 'DELETE /expenses') return deleteExpense(event);

  return err(404, 'Route not found');
});
```

---

## 4. CDK Registration Checklist

After writing the Lambda handler, infra-agent must:
- [ ] Add `NodejsFunction` in `CostsCrunchStack.ts`
- [ ] Grant DynamoDB permissions (`table.grantReadWriteData(fn)`)
- [ ] Grant S3 permissions if needed
- [ ] Add `BUCKET_ASSETS_NAME` or other env vars (no secrets — IAspect will fail synth)
- [ ] Register API Gateway route with JWT authorizer
- [ ] Mirror env vars in: `setup.sh`, `bootstrap.sh`, SAM template, `.env.test`

---

## 5. Local Dev Registration (Opt3 — SAM)

Add the function to `infrastructure/sam/template-arm.yaml` (and `template-x64.yaml`):

```yaml
MyNewFunction:
  Type: AWS::Serverless::Function
  Properties:
    Handler: index.handler
    CodeUri: ../backend/
    Metadata:
      BuildMethod: esbuild
      BuildProperties:
        EntryPoints: [src/lambdas/my-new/index.ts]
    Events:
      Api:
        Type: Api
        Properties:
          Path: /my-new
          Method: POST
```

---

## 6. Prompt Template

```
Add a Lambda endpoint [METHOD] /[path] to the CostsCrunch backend.
It should [description].
Follow the withErrorHandler + getAuth + Zod pattern in backend/src/lambdas/expenses/index.ts.
DynamoDB table: TABLE_NAME_MAIN. PK=USER#<userId>, SK=EXPENSE#<id>.
GSI1=STATUS#<status>/DATE#<date>. GSI2=CATEGORY#<cat>/DATE#<date>.
Include a Vitest unit test in backend/__tests__/unit/ using aws-sdk-client-mock.
```

---

## 7. Test the New Endpoint

```bash
# Unit test
cd backend && npm run test:ut

# Integration test (LocalStack required)
cd backend && npm run test:ig

# Manual smoke test (opt3)
npm run dev:opt3
curl -X POST http://localhost:3001/my-new \
  -H "Authorization: Bearer mock" \
  -H "Content-Type: application/json" \
  -d '{"amount": 42.50, "category": "food"}'
```
