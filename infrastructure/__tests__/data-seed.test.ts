/**
 * data-seed.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Validates that setup.sh correctly seeds DynamoDB with data model compliance.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "node:child_process";

const ENDPOINT = "http://localhost:4566";
const TABLE_NAME = "costscrunch-dev-main";

function aws(args: string): string {
  // Use docker exec because aws-cli is available inside the container, not necessarily on the host
  return execSync(
    `docker exec costscrunch-localstack /usr/local/bin/aws --endpoint-url=http://localhost:4566 --region us-east-1 --output json ${args}`,
    { encoding: "utf-8" }
  );
}

describe("Infrastructure: Data Model Compliance", () => {
  it("should seed groups with correct members array (AttributeType: L)", () => {
    const output = JSON.parse(aws(
      `dynamodb get-item --table-name ${TABLE_NAME} --key '{"pk":{"S":"GROUP#g1"},"sk":{"S":"PROFILE#g1"}}'`
    ));
    
    expect(output.Item).toBeDefined();
    expect(output.Item.members.L).toBeDefined(); // Must be a List
    expect(output.Item.members.L.length).toBeGreaterThan(0);
    
    const firstMember = output.Item.members.L[0].M;
    expect(firstMember.userId.S).toBeDefined();
    expect(firstMember.role.S).toBeDefined();
  });

  it("should seed expenses with splits for balance calculation", () => {
    const output = JSON.parse(aws(
      `dynamodb get-item --table-name ${TABLE_NAME} --key '{"pk":{"S":"GROUP#group-001"},"sk":{"S":"EXPENSE#exp-group-001"}}'`
    ));
    
    expect(output.Item.splits.L).toBeDefined();
    expect(output.Item.splits.L.length).toBeGreaterThan(0);
  });

  it("should have correct enum values for group types", () => {
    const output = JSON.parse(aws(
      `dynamodb get-item --table-name ${TABLE_NAME} --key '{"pk":{"S":"GROUP#g2"},"sk":{"S":"PROFILE#g2"}}'`
    ));
    
    const validTypes = ["personal", "trip", "household", "business", "project"];
    expect(validTypes).toContain(output.Item.type.S);
  });
});
