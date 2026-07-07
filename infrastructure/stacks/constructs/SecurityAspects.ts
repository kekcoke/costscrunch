import { Annotations, Aspects } from "aws-cdk-lib";
import { IConstruct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { IAspect } from "aws-cdk-lib";

/**
 * Ensures all S3 Buckets and DynamoDB Tables have KMS encryption configured.
 * Checked at CDK synthesis time.
 */
export class EncryptionEnforcementAspect implements IAspect {
  public visit(node: IConstruct): void {
    if (node instanceof s3.CfnBucket) {
      if (!node.bucketEncryption) {
        Annotations.of(node).addError("S3 Bucket must have encryption configured.");
      }
    }
    if (node instanceof dynamodb.CfnTable) {
      const sse = node.sseSpecification;
      if (!sse || (sse as any).sseEnabled === false) {
        Annotations.of(node).addError("DynamoDB Table must have SSE encryption enabled.");
      }
    }
    // TableV2 synthesizes to AWS::DynamoDB::GlobalTable
    if (node instanceof dynamodb.CfnGlobalTable) {
      if (!(node as dynamodb.CfnGlobalTable).sseSpecification) {
        Annotations.of(node).addError("DynamoDB GlobalTable must have SSE encryption enabled.");
      }
    }
  }
}

/**
 * Registers all security Aspects on the given scope.
 * Call once from CostsCrunchStack after all constructs are created.
 */
export function applySecurityAspects(scope: IConstruct, environment: string): void {
  Aspects.of(scope).add(new EncryptionEnforcementAspect());

  // OWASP ASVS v4.0 V13.1 — fail synthesis if MOCK_AUTH is set outside dev.
  if (environment !== "dev") {
    Annotations.of(scope).addInfo(
      `Scanning all Lambda functions for MOCK_AUTH env-var (stage=${environment})`,
    );
    Aspects.of(scope).add({
      visit(node: IConstruct) {
        if (node instanceof lambda.Function) {
          const fnEnv = (node as any).environment as Record<string, string> | undefined;
          if (fnEnv && "MOCK_AUTH" in fnEnv) {
            Annotations.of(node).addError(
              `MOCK_AUTH environment variable found on ${node.node.path}. ` +
              `Mock authentication bypasses MUST NOT be deployed to ${environment}. ` +
              "Remove MOCK_AUTH from this function's environment. " +
              "See OWASP ASVS v4.0 control V13.1.",
            );
          }
        }
      },
    });
  }

  // OWASP ASVS v4.0 V13.1 — fail synthesis if sensitive values appear as plain text env vars.
  const SENSITIVE_PATTERNS = [
    /^(api[_-]?key|secret|password|token|credential)/i,
    /^(aws[_-]??(access[_-]?key|secret))/i,
    /^(bearer|auth[_-]?token)/i,
    /@costscrunch\.(com|io|dev)$/,
  ];

  Aspects.of(scope).add({
    visit(node: IConstruct) {
      if (node instanceof lambda.Function) {
        const fnEnv = (node as any).environment as Record<string, string> | undefined;
        if (!fnEnv) return;

        for (const [key, value] of Object.entries(fnEnv)) {
          if (key.startsWith("SSM_") || key.startsWith("SECRET_")) continue;

          if (SENSITIVE_PATTERNS.some(p => p.test(key))) {
            Annotations.of(node).addError(
              `Sensitive env var '${key}' found on ${node.node.path}. ` +
              "Store secrets in SSM Parameter Store or Secrets Manager. " +
              "See OWASP ASVS v4.0 control V13.1.",
            );
          }

          if (/@costscrunch\.(com|io|dev)$/.test(value)) {
            Annotations.of(node).addError(
              `Email-like value detected in env var '${key}' on ${node.node.path}. ` +
              "Move to Secrets Manager.",
            );
          }
        }
      }
    },
  });
}
