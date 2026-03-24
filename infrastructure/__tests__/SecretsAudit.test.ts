import { describe, it, expect } from "vitest";
import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { CostsCrunchStack } from "../stacks/CostsCrunchStack";

describe("Secrets Audit", () => {
  const app = new cdk.App();

  // Set required env vars for stable synthesis during tests
  process.env.VITE_APP_URL = "https://staging.costscrunch.io";
  process.env.ALARM_LAMBDA_ERROR_RATE_THRESHOLD = "5";

  const stack = new CostsCrunchStack(app, "TestStack", {
    environment: "staging",
    env: {
      account: "123456789012",
      region: "us-east-1"
    }
  });
  const template = Template.fromStack(stack);

  /**
   * Recursively extract all string values from the synthesized CloudFormation template.
   * Filters out CloudFormation intrinsic functions (Fn::*, Ref).
   */
  function extractStrings(obj: unknown, path = ""): Array<{ path: string; value: string }> {
    const strings: Array<{ path: string; value: string }> = [];

    if (typeof obj === "string") {
      strings.push({ path, value: obj });
    } else if (Array.isArray(obj)) {
      obj.forEach((item, i) => {
        strings.push(...extractStrings(item, `${path}[${i}]`));
      });
    } else if (obj && typeof obj === "object") {
      for (const [key, value] of Object.entries(obj)) {
        // Skip CloudFormation intrinsic functions
        if (key.startsWith("Fn::") || key === "Ref" || key === "Condition") continue;
        strings.push(...extractStrings(value, path ? `${path}.${key}` : key));
      }
    }

    return strings;
  }

  /**
   * Check if a value is a concrete string (not a CDK token/object)
   */
  function isConcreteString(value: unknown): value is string {
    return typeof value === "string" && !value.startsWith("${Token[");
  }

  it("should NOT have hardcoded email addresses in Lambda environment variables", () => {
    const lambdaFunctions = template.findResources("AWS::Lambda::Function");

    for (const [logicalId, fn] of Object.entries(lambdaFunctions)) {
      const envVars = (fn as any).Properties?.Environment?.Variables ?? {};

      for (const [key, value] of Object.entries(envVars)) {
        // SSM/Secrets Manager parameter path references are allowed
        if (key.startsWith("SSM_") || key.startsWith("SECRET_")) continue;

        // CDK tokens are unresolved - skip them (they'll be populated at deploy time)
        if (!isConcreteString(value)) continue;

        expect(value).not.toMatch(/@costscrunch\.(com|io|dev)/);
      }
    }
  });

  it("should NOT have hardcoded sensitive values in any Lambda env vars", () => {
    const lambdaFunctions = template.findResources("AWS::Lambda::Function");

    for (const [logicalId, fn] of Object.entries(lambdaFunctions)) {
      const envVars = (fn as any).Properties?.Environment?.Variables ?? {};

      for (const [key, value] of Object.entries(envVars)) {
        // SSM/Secrets Manager parameter path references are allowed
        if (key.startsWith("SSM_") || key.startsWith("SECRET_")) continue;

        // CDK tokens are unresolved - skip them
        if (!isConcreteString(value)) continue;

        // Check for sensitive key patterns
        expect(key).not.toMatch(/^(api[_-]?key|secret|password|token|credential|bearer)/i);

        // Check for AWS access keys
        expect(value).not.toMatch(/AKIA[0-9A-Z]{16}/);
      }
    }
  });

  it("should NOT expose secrets in CloudFormation Outputs", () => {
    const outputs = template.toJSON().Outputs ?? {};

    for (const [outputId, output] of Object.entries(outputs)) {
      const outputValue = (output as any).Value;
      if (!isConcreteString(outputValue)) continue;

      // SSM/Secrets Manager ARNs are allowed in outputs
      if (outputValue.includes("ssm:") || outputValue.includes("secretsmanager:")) continue;

      // Check for sensitive patterns
      expect(outputValue).not.toMatch(/AKIA[0-9A-Z]{16}/);
      expect(outputValue).not.toMatch(/@costscrunch\.(com|io|dev)/);
    }
  });

  it("should store notification secrets in Secrets Manager", () => {
    // Verify Secrets Manager secret exists
    const secrets = template.findResources("AWS::SecretsManager::Secret");
    expect(Object.keys(secrets).length).toBeGreaterThan(0);

    // Verify a notification-related secret exists
    const hasNotificationSecret = Object.values(secrets).some(
      (s: any) => s.Properties?.Name?.includes("notification") ||
                  s.Properties?.SecretString?.includes("fromEmail")
    );
    expect(hasNotificationSecret).toBe(true);
  });

  it("should store configuration in SSM Parameter Store", () => {
    // Verify SSM parameters exist
    const params = template.findResources("AWS::SSM::Parameter");
    expect(Object.keys(params).length).toBeGreaterThan(0);

    // Verify Bedrock and ViteApp parameters exist (names may be CDK tokens in tests)
    const hasBedrockParam = Object.values(params).some(
      (p: any) => p.Properties?.Name?.includes("bedrock")
    );
    const hasViteAppParam = Object.values(params).some(
      (p: any) => p.Properties?.Name?.includes("vite-app")
    );

    expect(hasBedrockParam).toBe(true);
    expect(hasViteAppParam).toBe(true);
  });

  it("should use SSM/SECRET parameter references in Lambda env vars (not actual values)", () => {
    const lambdaFunctions = template.findResources("AWS::Lambda::Function");

    // Find functions with SSM/SECRET references
    const functionsWithSecretRefs = Object.entries(lambdaFunctions).filter(([_, fn]) => {
      const envVars = (fn as any).Properties?.Environment?.Variables ?? {};
      return Object.keys(envVars).some(k => k.startsWith("SSM_") || k.startsWith("SECRET_"));
    });

    expect(functionsWithSecretRefs.length).toBeGreaterThan(0);
  });

  it("should grant notifications Lambda access to Secrets Manager", () => {
    const policies = template.findResources("AWS::IAM::Policy");

    let hasSecretsManagerAccess = false;
    for (const policy of Object.values(policies)) {
      const statements = (policy as any).Properties?.PolicyDocument?.Statement ?? [];
      for (const stmt of statements) {
        const actions = Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action].filter(Boolean);
        if (actions.includes("secretsmanager:GetSecretValue") ||
            actions.includes("secretsmanager:*")) {
          hasSecretsManagerAccess = true;
          break;
        }
      }
      if (hasSecretsManagerAccess) break;
    }

    expect(hasSecretsManagerAccess).toBe(true);
  });

  it("should NOT have FROM_EMAIL or PINPOINT_APP_ID as plain env vars", () => {
    const lambdaFunctions = template.findResources("AWS::Lambda::Function");

    for (const [logicalId, fn] of Object.entries(lambdaFunctions)) {
      const envVars = (fn as any).Properties?.Environment?.Variables ?? {};

      // These should NOT be direct env vars (they should be via SSM/Secrets Manager)
      expect(envVars.FROM_EMAIL).toBeUndefined();
      expect(envVars.PINPOINT_APP_ID).toBeUndefined();

      // But SSM/SECRET path references are fine
      if (envVars.SECRET_NOTIFICATION_ARN) {
        expect(isConcreteString(envVars.SECRET_NOTIFICATION_ARN) ||
               typeof envVars.SECRET_NOTIFICATION_ARN === "object").toBeTruthy();
      }
    }
  });
});
