import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { AnalyticsRepository } from "../../src/logic/analyticsRepository.js";

const ddbMock = mockClient(DynamoDBDocumentClient);

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
    date,
    amount,
    category: "Food"
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
      // Mock personal query
      ddbMock.on(QueryCommand)
        .resolvesOnce({ Items: [mockExpense("p1", "2023-01-05", 50)] }) // Personal
        .resolvesOnce({ Items: [{ groupId: "group-1" }] }) // Memberships
        .resolvesOnce({ Items: [mockExpense("g1", "2023-01-01", 20)] }); // Group 1

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
              { amount: 10, date: "2023-01-01" },
              { amount: 50, date: "2023-01-02" }
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
