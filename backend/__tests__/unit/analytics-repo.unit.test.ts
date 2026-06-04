import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, QueryCommand, BatchGetCommand } from "@aws-sdk/lib-dynamodb";
import { AnalyticsRepository } from "../../src/logic/analyticsRepository.js";

const ddbMock = mockClient(DynamoDBDocumentClient);

// Capture the TABLE name as the module sees it (from .env.dev loaded by vitest setup,
// before beforeEach overrides process.env.TABLE_NAME_MAIN to "TestTable").
const MODULE_TABLE = process.env.TABLE_NAME_MAIN!;

describe("AnalyticsRepository", () => {
  let repo: AnalyticsRepository;

  beforeEach(() => {
    ddbMock.reset();
    process.env.TABLE_NAME_MAIN = "TestTable";
    repo = new AnalyticsRepository();
  });

  const mockExpense = (id: string, date: string, amount: number) => ({
    pk: "USER#user-123",
    sk: `EXPENSE#${id}`,
    entityType: "EXPENSE",
    expenseId: id,
    ownerId: "user-123",
    merchant: "Test",
    amount,
    amountUSD: amount,
    currency: "USD",
    category: "Meals",
    date,
    status: "approved",
    source: "manual",
    tags: [],
    createdAt: "2023-01-01T00:00:00.000Z",
    updatedAt: "2023-01-01T00:00:00.000Z",
  });

  describe("getExpenses", () => {
    it("queries personal scope correctly", async () => {
      const mockData = [mockExpense("1", "2023-01-01", 10)];
      ddbMock.on(QueryCommand).resolves({ Items: mockData });

      const result = await repo.getExpenses({
        userId: "user-123",
        scope: "personal",
        startDate: "2023-01-01",
        endDate: "2023-01-31"
      });

      expect(result).toEqual(mockData);
      const calls = ddbMock.commandCalls(QueryCommand);
      expect(calls[0].args[0].input).toMatchObject({
        ExpressionAttributeValues: expect.objectContaining({
          ":pk": "USER#user-123"
        })
      });
    });

    it("applies category filters correctly", async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [] });

      await repo.getExpenses({
        userId: "user-123",
        scope: "personal",
        startDate: "2023-01-01",
        endDate: "2023-01-31",
        categories: ["Food", "Travel"]
      });

      const input = ddbMock.commandCalls(QueryCommand)[0].args[0].input;
      expect(input.FilterExpression).toContain("category IN (:cat0, :cat1)");
      expect(input.ExpressionAttributeValues).toMatchObject({
        ":cat0": "Food",
        ":cat1": "Travel"
      });
    });

    it("sorts 'all' scope results manually", async () => {
      ddbMock.on(QueryCommand)
        .resolvesOnce({ Items: [mockExpense("p1", "2023-01-05", 50)] }) // Personal
        .resolvesOnce({ Items: [{ groupId: "group-1" }] });              // Memberships
      ddbMock.on(BatchGetCommand)
        .resolvesOnce({ Responses: { [MODULE_TABLE]: [mockExpense("g1", "2023-01-01", 20)] }, UnprocessedKeys: {} });

      const result = await repo.getExpenses({
        userId: "user-123",
        scope: "all",
        startDate: "2023-01-01",
        endDate: "2023-01-31",
        sortBy: "date",
        sortOrder: "asc"
      });

      expect(result).toHaveLength(2);
      expect(result[0].date).toBe("2023-01-01");
      expect(result[1].date).toBe("2023-01-05");
    });

    it("supports sorting by amount descending", async () => {
        ddbMock.on(QueryCommand)
          .resolvesOnce({ Items: [mockExpense("1", "2023-01-05", 10)] })
          .resolvesOnce({ Items: [] }) // No groups
  
        const result = await repo.getExpenses({
          userId: "user-123",
          scope: "all",
          startDate: "2023-01-01",
          endDate: "2023-01-31",
          sortBy: "amount",
          sortOrder: "desc"
        });
        
        // Add another item to check sort
        ddbMock.reset();
        ddbMock.on(QueryCommand)
          .resolvesOnce({ Items: [
              mockExpense("a", "2023-01-01", 10),
              mockExpense("b", "2023-01-02", 50),
          ] })
          .resolvesOnce({ Items: [] });

        const sortedResult = await repo.getExpenses({
            userId: "user-123",
            scope: "all",
            startDate: "2023-01-01",
            endDate: "2023-01-31",
            sortBy: "amount",
            sortOrder: "desc"
        });

        expect(sortedResult[0].amount).toBe(50);
        expect(sortedResult[1].amount).toBe(10);
    });

    it("falls back to single category filter if categories list is missing", async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [] });

      await repo.getExpenses({
        userId: "user-123",
        scope: "personal",
        startDate: "2023-01-01",
        endDate: "2023-01-31",
        category: "Food"
      });

      const input = ddbMock.commandCalls(QueryCommand)[0].args[0].input;
      expect(input.FilterExpression).toContain("category = :category");
      expect(input.ExpressionAttributeValues).toMatchObject({
        ":category": "Food"
      });
    });
  });
});
