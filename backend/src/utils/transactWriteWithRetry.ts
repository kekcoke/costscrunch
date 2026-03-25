import {
  TransactWriteCommand,
  type TransactWriteCommandInput,
  type TransactWriteCommandOutput,
  type DynamoDBDocumentClient,
} from "@aws-sdk/lib-dynamodb";

// ─── Retry configuration ──────────────────────────────────────────────────────
const MAX_RETRIES    = 3;
const BASE_DELAY_MS  = 100;

/**
 * AWS wraps both genuine conflicts AND conditional-check failures under
 * `TransactionCanceledException`.  We must inspect `CancellationReasons`
 * to distinguish them:
 *
 *   - ALL reasons are "TransactionConflict" → transient, safe to retry
 *   - ANY reason is "ConditionalCheckFailed" → business-logic conflict, throw
 *
 * `TransactionConflictException` is also accepted as a standalone name for
 * SDK versions that surface it directly.
 */
function isRetryableError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;

  if (e.name === "TransactionConflictException") return true;

  if (e.name === "TransactionCanceledException") {
    const reasons = (e as any).CancellationReasons as
      | Array<{ Code?: string }>
      | undefined;

    if (!reasons || reasons.length === 0) return false;

    // Only retry if every cancelled item failed due to a conflict
    return reasons.every(r => r.Code === "TransactionConflict");
  }

  return false;
}

/**
 * Wrap a `TransactWriteCommand` with exponential-backoff retry for transient
 * transaction conflicts.
 *
 * @param client  - DynamoDB DocumentClient instance
 * @param params  - TransactWriteCommandInput (TransactItems, etc.)
 * @returns The raw SDK response from the successful TransactWrite
 * @throws  ConditionalCheckFailedException (or its TransactionCanceledException
 *          wrapper) straight through — no retry.
 * @throws  Any non-retryable error after the first attempt.
 */
export async function transactWriteWithRetry(
  client: DynamoDBDocumentClient,
  params: TransactWriteCommandInput,
): Promise<TransactWriteCommandOutput> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await client.send(new TransactWriteCommand(params));
    } catch (e: unknown) {
      lastError = e;

      // Don't retry conditional-check failures (business logic conflicts)
      if (!isRetryableError(e)) throw e;

      // Don't sleep after the last failed attempt
      if (attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt); // 100, 200, 400ms
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
