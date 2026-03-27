import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { rawHandler as handler } from "../../src/lambdas/receipts/index.js";

const ddbMock = mockClient(DynamoDBDocumentClient);
const s3Mock = mockClient(S3Client);

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn().mockResolvedValue("https://s3.localstack:4566/signed-download-url"),
}));

describe("Receipts Download Logic", () => {
  beforeEach(() => {
    ddbMock.reset();
    s3Mock.reset();
    process.env.BUCKET_PROCESSED_NAME = "test-processed-bucket";
  });

  const makeEvent = (expenseId: string, sub = "user-123") => ({
    routeKey: "GET /receipts/{expenseId}/download",
    pathParameters: { expenseId },
    requestContext: {
      authorizer: {
        jwt: {
          claims: { sub }
        }
      }
    }
  });

  it("returns 401 if user is not authenticated", async () => {
    const event = makeEvent("exp-1");
    delete (event.requestContext.authorizer as any).jwt;
    
    const res = await handler(event as any, {} as any);
    expect(res.statusCode).toBe(401);
  });

  it("returns 404 if expense has no receiptKey", async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { id: "exp-1", receiptKey: null }
    });

    const res = await handler(makeEvent("exp-1") as any, {} as any);
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error).toContain("No receipt found");
  });

  it("returns a presigned URL on success", async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { 
        id: "exp-1", 
        receiptKey: "receipts/user-123/exp-1/file.pdf" 
      }
    });

    const res = await handler(makeEvent("exp-1") as any, {} as any);
    
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.downloadUrl).toBe("https://s3.localstack:4566/signed-download-url");
  });
});
