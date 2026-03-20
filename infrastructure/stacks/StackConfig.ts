import * as cdk from "aws-cdk-lib";
import { IConstruct } from "constructs";

export interface StackConfig {
  readonly isTest: boolean;
  readonly accountId: string;
  readonly regionId: string;
  readonly pinpointAppId: string;
  readonly webSocketEndpoint: string;
  readonly apiUrl: string;
}

/**
 * Builds the stack configuration by detecting the environment and loading 
 * fallbacks from process.env (useful for Vitest).
 */
export function buildStackConfig(scope: IConstruct, account?: string, region?: string): StackConfig {
  const isTestContext = scope.node.tryGetContext("isTest") === "true";
  
  // CDK environment attributes can be tokens in unit tests.
  // We use String() conversion to safely check if the value contains a token placeholder
  // without triggering a resolution error on the Token object itself.
  const isAccountToken = !account || cdk.Token.isUnresolved(account) || String(account).includes("${Token");
  const isRegionToken = !region || cdk.Token.isUnresolved(region) || String(region).includes("${Token");
  
  const isTest = isTestContext || isAccountToken || isRegionToken;

  return {
    isTest,
    accountId: isTest ? (process.env.CDK_TEST_ACCOUNT || "123456789012") : (account!),
    regionId: isTest ? (process.env.CDK_TEST_REGION || "us-east-1") : (region!),
    pinpointAppId: isTest ? (process.env.CDK_TEST_PINPOINT_ID || "dummy-pinpoint-id") : "actual-id-from-ssm", 
    webSocketEndpoint: isTest 
      ? (process.env.CDK_TEST_WS_ENDPOINT || "https://dummy-ws.execute-api.us-east-1.amazonaws.com/prod") 
      : "",
    apiUrl: isTest ? (process.env.CDK_TEST_API_URL || "https://dummy-api.com") : "",
  };
}
