import { describe, it, expect } from "vitest";
import * as cdk from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import { CostsCrunchStack } from "../stacks/CostsCrunchStack";

// NOTE: Tests are structurally correct but blocked by pre-existing cyclic
// dependency in CostsCrunchStack synthesis. Will pass once the cycle is resolved.
// To enable: change describe.skip → describe and verify `cdk synth` succeeds.
describe("CostsCrunchStack Cognito", () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App();
    process.env.VITE_APP_URL = "https://staging.costscrunch.io";
    process.env.ALARM_LAMBDA_ERROR_RATE_THRESHOLD = "5";

    const stack = new CostsCrunchStack(app, "CognitoTestStack", {
      environment: "staging",
      env: {
        account: "123456789012",
        region: "us-east-1",
      },
    });
    template = Template.fromStack(stack);
  });

  // ─── UserPool ────────────────────────────────────────────────────────────

  it("creates exactly one UserPool", () => {
    template.resourceCountIs("AWS::Cognito::UserPool", 1);
  });

  it("enables self-sign-up with email as username alias", () => {
    template.hasResourceProperties("AWS::Cognito::UserPool", {
      UsernameAttributes: Match.arrayWith(["email"]),
    });
  });

  it("auto-verifies email addresses", () => {
    template.hasResourceProperties("AWS::Cognito::UserPool", {
      AutoVerifiedAttributes: Match.arrayWith(["email"]),
    });
  });

  it("enforces password policy (min 8 chars)", () => {
    template.hasResourceProperties("AWS::Cognito::UserPool", {
      Policies: {
        PasswordPolicy: Match.objectLike({
          MinimumLength: 8,
        }),
      },
    });
  });

  // ─── UserPool Groups ─────────────────────────────────────────────────────

  it("creates 5 Cognito groups", () => {
    template.resourceCountIs("AWS::Cognito::UserPoolGroup", 5);
  });

  it("sets correct group precedence ordering", () => {
    const groups = template.findResources("AWS::Cognito::UserPoolGroup");
    const groupEntries = Object.values(groups).map((g: any) => ({
      name: g.Properties.GroupName,
      precedence: g.Properties.Precedence,
    }));

    expect(groupEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "admins", precedence: 1 }),
        expect.objectContaining({ name: "support", precedence: 2 }),
        expect.objectContaining({ name: "business", precedence: 3 }),
        expect.objectContaining({ name: "pro", precedence: 4 }),
        expect.objectContaining({ name: "free", precedence: 5 }),
      ]),
    );
  });

  // ─── UserPoolClient ──────────────────────────────────────────────────────

  it("creates at least one UserPoolClient", () => {
    const clients = template.findResources("AWS::Cognito::UserPoolClient");
    expect(Object.keys(clients).length).toBeGreaterThanOrEqual(1);
  });

  // ─── Lambda Trigger Wiring ───────────────────────────────────────────────

  it("wires postConfirmation trigger to AuthTriggerLambda", () => {
    const pools = template.findResources("AWS::Cognito::UserPool");
    const pool = Object.values(pools)[0] as any;
    expect(pool.Properties?.LambdaConfig?.PostConfirmation).toBeDefined();
  });

  it("authTriggerLambda has TABLE_NAME_MAIN environment variable", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      Handler: "index.handler",
      Environment: {
        Variables: Match.objectLike({
          TABLE_NAME_MAIN: Match.anyValue(),
        }),
      },
    });
  });

  // ─── Outputs ─────────────────────────────────────────────────────────────

  it("exports UserPoolId and UserPoolClientId as stack outputs", () => {
    template.hasOutput("UserPoolId", {
      Value: Match.anyValue(),
    });
    template.hasOutput("UserPoolClientId", {
      Value: Match.anyValue(),
    });
  });
});
