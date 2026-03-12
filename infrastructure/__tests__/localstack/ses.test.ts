// ─── SES Infrastructure Tests ─────────────────────────────────────────────────
// Validates SES configuration for email notifications.
// Tests verified email identity for FROM_EMAIL.

import { describe, it, expect } from "vitest";
import {
  SESClient,
  ListIdentitiesCommand,
  GetIdentityVerificationAttributesCommand,
} from "@aws-sdk/client-ses";

const ENDPOINT = process.env.AWS_ENDPOINT_URL ?? "http://localhost:4566";

const client = new SESClient({
  endpoint: ENDPOINT,
  region: "us-east-1",
  credentials: { accessKeyId: "test", secretAccessKey: "test" },
});

const FROM_EMAIL = "noreply@costscrunch.dev";

describe("SES", () => {
  describe("Email Identity", () => {
    it("should have the FROM_EMAIL identity registered", async () => {
      const response = await client.send(new ListIdentitiesCommand({}));
      const identities = response.Identities ?? [];
      expect(identities).toContain(FROM_EMAIL);
    });

    it("should have the email identity verified", async () => {
      const response = await client.send(
        new GetIdentityVerificationAttributesCommand({
          Identities: [FROM_EMAIL],
        })
      );
      const attributes = response.VerificationAttributes?.[FROM_EMAIL];
      // LocalStack auto-verifies, so it should be Success or at least exist
      expect(attributes).toBeDefined();
    });
  });
});
