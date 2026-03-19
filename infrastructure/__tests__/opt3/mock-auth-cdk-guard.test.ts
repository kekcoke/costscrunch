// ─── CDK Synthesis Guard — MOCK_AUTH blocked in non-dev stacks ────────────────
// OWASP ASVS v4.0 V13.1
//
// Tests the CDK Aspect in isolation (no full CostsCrunchStack synthesis,
// which requires real AWS account/region context). The aspect logic is
// extracted inline to mirror exactly what CostsCrunchStack applies.

import { describe, it, expect } from "vitest";
import { App, Stack, Annotations, Aspects } from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { IConstruct } from "constructs";

// Replicates the exact aspect applied in CostsCrunchStack
function applyMockAuthGuard(stack: Stack, environment: string) {
  if (environment !== "dev") {
    Annotations.of(stack).addInfo(
      `Scanning all Lambda functions for MOCK_AUTH env-var (stage=${environment})`
    );
    Aspects.of(stack).add({
      visit(node: IConstruct) {
        if (node instanceof lambda.Function) {
          const fnEnv = (node as any).environment as Record<string, string> | undefined;
          if (fnEnv && "MOCK_AUTH" in fnEnv) {
            Annotations.of(node).addError(
              `MOCK_AUTH environment variable found on ${node.node.path}. ` +
              `Mock authentication bypasses MUST NOT be deployed to ${environment}. ` +
              "Remove MOCK_AUTH from this function's environment. " +
              "See OWASP ASVS v4.0 control V13.1."
            );
          }
        }
      },
    });
  }
}

function getErrors(app: App): { data: string; id: string }[] {
  const assembly = app.synth();
  const errors: { data: string; id: string }[] = [];
  // artifacts may be a Map (ESM) or plain object (CJS)
  const entries = assembly.artifacts instanceof Map
    ? assembly.artifacts.entries()
    : Object.entries(assembly.artifacts);
  for (const [_key, artifact] of entries) {
    const msgs = (artifact as any).messages as Array<{ level: string; entry: { data: string } }>;
    if (msgs) {
      for (const msg of msgs) {
        if (msg.level === "error") {
          errors.push({ data: msg.entry.data, id: (artifact as any).id });
        }
      }
    }
  }
  return errors;
}

function createStackWithLambda(app: App, env: Record<string, string> | undefined) {
  const stack = new Stack(app, "TestStack");
  new lambda.Function(stack, "TestFn", {
    runtime: lambda.Runtime.NODEJS_20_X,
    handler: "index.handler",
    code: lambda.Code.fromInline("export const handler = () => {}"),
    environment: env,
  });
  return stack;
}

describe("CDK guard: MOCK_AUTH env-var blocked in non-dev stages", () => {
  it("should NOT add errors when no Lambda has MOCK_AUTH (staging)", () => {
    const app = new App();
    const stack = createStackWithLambda(app, { FOO: "bar" });
    applyMockAuthGuard(stack, "staging");

    expect(getErrors(app)).toHaveLength(0);
  });

  it("should NOT add errors when no Lambda has MOCK_AUTH (prod)", () => {
    const app = new App();
    const stack = createStackWithLambda(app, {});
    applyMockAuthGuard(stack, "prod");

    expect(getErrors(app)).toHaveLength(0);
  });

  it("should NOT apply the aspect in dev stage (even with MOCK_AUTH set)", () => {
    const app = new App();
    const stack = createStackWithLambda(app, { MOCK_AUTH: "true" });
    applyMockAuthGuard(stack, "dev");

    // Aspect is not applied in dev, so no error annotation is added
    expect(getErrors(app)).toHaveLength(0);
  });

  it("should produce an error when a Lambda in staging has MOCK_AUTH env-var", () => {
    const app = new App();
    const stack = createStackWithLambda(app, { MOCK_AUTH: "true" });
    applyMockAuthGuard(stack, "staging");

    const errors = getErrors(app);
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0].data).toMatch(/MOCK_AUTH environment variable found/);
    expect(errors[0].data).toMatch(/staging/);
    expect(errors[0].data).toMatch(/V13\.1/);
  });

  it("should produce an error when a Lambda in prod has MOCK_AUTH env-var", () => {
    const app = new App();
    const stack = createStackWithLambda(app, { MOCK_AUTH: "true" });
    applyMockAuthGuard(stack, "prod");

    const errors = getErrors(app);
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0].data).toMatch(/prod/);
    expect(errors[0].data).toMatch(/V13\.1/);
  });

  it("should identify the specific Lambda function path in the error", () => {
    const app = new App();
    const stack = createStackWithLambda(app, { MOCK_AUTH: "true" });
    applyMockAuthGuard(stack, "staging");

    const errors = getErrors(app);
    expect(errors[0].data).toMatch(/TestFn/);
  });

  it("should flag each Lambda individually when multiple have MOCK_AUTH", () => {
    const app = new App();
    const stack = new Stack(app, "TestStack");
    new lambda.Function(stack, "FnA", {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "index.handler",
      code: lambda.Code.fromInline("export const handler = () => {}"),
      environment: { MOCK_AUTH: "true" },
    });
    new lambda.Function(stack, "FnB", {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "index.handler",
      code: lambda.Code.fromInline("export const handler = () => {}"),
      environment: { MOCK_AUTH: "true" },
    });
    applyMockAuthGuard(stack, "prod");

    const errors = getErrors(app);
    expect(errors.length).toBe(2);
    expect(errors[0].data).toMatch(/FnA/);
    expect(errors[1].data).toMatch(/FnB/);
  });

  it("should not flag Lambdas without MOCK_AUTH even when others have it", () => {
    const app = new App();
    const stack = new Stack(app, "TestStack");
    new lambda.Function(stack, "SafeFn", {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "index.handler",
      code: lambda.Code.fromInline("export const handler = () => {}"),
      environment: { LOG_LEVEL: "INFO" },
    });
    new lambda.Function(stack, "UnsafeFn", {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "index.handler",
      code: lambda.Code.fromInline("export const handler = () => {}"),
      environment: { MOCK_AUTH: "true" },
    });
    applyMockAuthGuard(stack, "staging");

    const errors = getErrors(app);
    expect(errors.length).toBe(1);
    expect(errors[0].data).toMatch(/UnsafeFn/);
    expect(errors[0].data).not.toMatch(/SafeFn/);
  });
});
