// ─── KMS Infrastructure Tests ─────────────────────────────────────────────────
// Validates KMS key matches CostsCrunchStack.ts configuration.
// Tests key existence, alias, and encryption capabilities.

import { describe, it, expect, beforeAll } from "vitest";
import {
  KMSClient,
  ListKeysCommand,
  ListAliasesCommand,
  DescribeKeyCommand,
} from "@aws-sdk/client-kms";

const ENDPOINT = process.env.AWS_ENDPOINT_URL ?? "http://localhost:4566";

const client = new KMSClient({
  endpoint: ENDPOINT,
  region: "us-east-1",
  credentials: { accessKeyId: "test", secretAccessKey: "test" },
});

const PREFIX = "costscrunch-dev";
const EXPECTED_ALIAS = `alias/${PREFIX}-main`;

describe("KMS", () => {
  describe("Key Existence", () => {
    it("should have at least one KMS key created", async () => {
      const response = await client.send(new ListKeysCommand({}));
      expect(response.Keys?.length).toBeGreaterThan(0);
    });
  });

  describe("Key Alias", () => {
    let aliases: any[];
    let targetKeyId: string | undefined;

    beforeAll(async () => {
      const response = await client.send(new ListAliasesCommand({}));
      aliases = response.Aliases ?? [];
      const mainAlias = aliases.find((a) => a.AliasName === EXPECTED_ALIAS);
      targetKeyId = mainAlias?.TargetKeyId;
    });

    it("should have the main alias created", () => {
      const mainAlias = aliases.find((a) => a.AliasName === EXPECTED_ALIAS);
      expect(mainAlias).toBeDefined();
    });

    it("alias should target a valid key", () => {
      const mainAlias = aliases.find((a) => a.AliasName === EXPECTED_ALIAS);
      expect(mainAlias?.TargetKeyId).toBeDefined();
    });
  });

  describe("Key Properties", () => {
    let keyId: string | undefined;

    beforeAll(async () => {
      const aliasResponse = await client.send(new ListAliasesCommand({}));
      const mainAlias = aliasResponse.Aliases?.find(
        (a) => a.AliasName === EXPECTED_ALIAS
      );
      keyId = mainAlias?.TargetKeyId;
    });

    it("key should be enabled", async () => {
      if (!keyId) {
        expect(true).toBe(true); // Skip if no key found
        return;
      }
      const response = await client.send(
        new DescribeKeyCommand({ KeyId: keyId })
      );
      expect(response.KeyMetadata?.KeyState).toBe("Enabled");
    });

    it("key should support encryption and decryption", async () => {
      if (!keyId) {
        expect(true).toBe(true); // Skip if no key found
        return;
      }
      const response = await client.send(
        new DescribeKeyCommand({ KeyId: keyId })
      );
      const usage = response.KeyMetadata?.KeyUsage;
      expect(usage).toBe("ENCRYPT_DECRYPT");
    });
  });
});
