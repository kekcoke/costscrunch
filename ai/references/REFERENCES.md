# CostsCrunch — REFERENCES.md
## Library & Service Documentation

---

## Frontend

| Library | Version | Purpose | Key Docs |
|---|---|---|---|
| React | 19.2 | UI framework | https://react.dev/reference |
| React Router | 7.13 | Client-side routing | https://reactrouter.com/en/main |
| Vite | 7.3 | Build tool | https://vitejs.dev/guide |
| Vitest | 4.0 | Test runner | https://vitest.dev/api |
| @testing-library/react | 16.3 | Component testing | https://testing-library.com/docs/react-testing-library/intro |
| @testing-library/user-event | 14.6 | User interaction simulation | https://testing-library.com/docs/user-event/intro |
| Zustand | 5.0 | State management | https://docs.pmnd.rs/zustand/getting-started/introduction |
| @tanstack/react-query | 5.90 | Server state / caching | https://tanstack.com/query/latest |
| @aws-amplify/auth | 6.19 | Authentication | https://docs.amplify.aws/gen1/react/build-a-backend/auth/ |
| Reselect | 5.1 | Memoized selectors | https://github.com/reduxjs/reselect |

### Key React patterns used
- startTransition for non-urgent state updates (chart switching): https://react.dev/reference/react/startTransition
- Suspense + lazy loading: https://react.dev/reference/react/Suspense
- useCallback / useMemo for perf: https://react.dev/reference/react/useCallback

---

## Backend

| Library | Version | Purpose | Key Docs |
|---|---|---|---|
| Express | 4.22 | Web framework (Local Dev) | https://expressjs.com/ |
| @aws-sdk/client-dynamodb | 3.635 | DynamoDB low-level | https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/dynamodb |
| @aws-sdk/lib-dynamodb | 3.635 | DynamoDB document client | https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-lib-dynamodb |
| @aws-sdk/client-s3 | 3.635 | S3 operations | https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/s3 |
| @aws-sdk/client-textract | 3.635 | Document text extraction | https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/textract |
| @aws-sdk/client-bedrock-runtime | 3.635 | AI categorization (Claude) | https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/bedrock-runtime |
| @aws-sdk/client-ssm | 3.1002 | Parameter Store access | https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/ssm |
| @aws-lambda-powertools/logger | 2.7 | Structured logging | https://docs.powertools.aws.dev/lambda/typescript/latest/core/logger |
| @aws-lambda-powertools/idempotency | 2.7 | Idempotent Lambda handlers | https://docs.powertools.aws.dev/lambda/typescript/latest/utilities/idempotency |
| @aws-lambda-powertools/batch | 2.7 | SQS/Kinesis batch processing | https://docs.powertools.aws.dev/lambda/typescript/latest/utilities/batch |
| Jest | 29.7 | Backend testing framework | https://jestjs.io/docs/getting-started |
| ulid | 2.3 | Sortable unique IDs | https://github.com/ulid/spec |
| zod | 3.23 | Runtime schema validation | https://zod.dev |

---

## AWS Services

| Service | Role | Key Docs |
|---|---|---|
| Cognito | Identity: users, TOTP MFA, OAuth 2.0 PKCE (Google/GitHub/Microsoft) | https://docs.aws.amazon.com/cognito/latest/developerguide |
| API Gateway HTTP v2 | All REST endpoints; JWT Authorizer validates Cognito tokens | https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api.html |
| Lambda | All business logic; Node.js 20, 1 GB RAM, 29 s timeout | https://docs.aws.amazon.com/lambda/latest/dg/welcome.html |
| DynamoDB | Single-table, on-demand, Global Tables (us-east-1 + us-west-2) | https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Introduction.html |
| S3 | Receipt images, statement files, static frontend assets | https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html |
| Textract | DetectDocumentText for PDF statement parsing + receipt OCR | https://docs.aws.amazon.com/textract/latest/dg/what-is.html |
| Bedrock | Claude claude-3-5-haiku for receipt categorization | https://docs.aws.amazon.com/bedrock/latest/userguide/what-is-bedrock.html |
| SES | Transactional emails (approval, notification digest) | https://docs.aws.amazon.com/ses/latest/dg/Welcome.html |
| EventBridge | Custom bus; triggers notifications lambda from expense events | https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-what-is.html |
| SQS FIFO | Notification queue + DLQ; guarantees ordered delivery | https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/welcome.html |
| ElastiCache Redis | Rate limiting + session cache | https://docs.aws.amazon.com/AmazonElastiCache/latest/red-ug/WhatIs.html |
| CloudFront | CDN for frontend + API; HTTPS redirect enforced | https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Introduction.html |
| WAF v2 | OWASP managed rules + rate limiting on API | https://docs.aws.amazon.com/waf/latest/developerguide/waf-chapter.html |
| KMS | CMK auto-rotation for DynamoDB, S3, SES | https://docs.aws.amazon.com/kms/latest/developerguide/overview.html |
| X-Ray | Distributed tracing via @aws-lambda-powertools/tracer | https://docs.aws.amazon.com/xray/latest/devguide/aws-xray.html |
| SSM Parameter Store | Secure env var storage for Lambda (SecureString) | https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-parameter-store.html |

---

## Auth & Security Standards

| Standard | Reference |
|---|---|
| OAuth 2.0 Authorization Code + PKCE | https://datatracker.ietf.org/doc/html/rfc7636 |
| JWT (RFC 7519) | https://datatracker.ietf.org/doc/html/rfc7519 |
| OWASP Top 10 | https://owasp.org/www-project-top-ten |
| Cognito JWT verification | https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-tokens-verifying-a-jwt.html |
| httpOnly Cookie best practices | https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies#security |

---

## Infrastructure

| Library | Purpose | Docs |
|---|---|---|
| aws-cdk-lib v2 | CDK v2 constructs | https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib-readme.html |
| @aws-cdk/assertions | CDK testing | https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.assertions-readme.html |

---

## Testing

| Tool | Key Docs |
|---|---|
| Vitest 1.2 | https://vitest.dev |
| @testing-library/react 14 | https://testing-library.com/docs/react-testing-library/api |
| jest-dom 6 | https://github.com/testing-library/jest-dom |
| aws-sdk-client-mock 3 | https://github.com/m-radzikowski/aws-sdk-client-mock |
| Jest 29 | https://jestjs.io/docs/getting-started |
| k6 0.49 | https://grafana.com/docs/k6/latest |
| LocalStack 3.5 | https://docs.localstack.cloud/getting-started |

---

## Load Testing Targets

| Metric | Target |
|---|---|
| P95 list expenses | < 300 ms |
| P95 create expense | < 500 ms |
| P99 overall (CDN cached) | < 80 ms |
| Error rate | < 1% |
| Statement import (50-row CSV) | < 3 s |