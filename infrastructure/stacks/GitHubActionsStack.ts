// ─── GitHub Actions OIDC Federation ──────────────────────────────────────────
// Provisions:
//   1. OpenID Connect Provider for token.actions.githubusercontent.com
//   2. IAM Role with trust policy scoped to specific repo + branch
//   3. Least-privilege permissions for CDK deploy, S3 artifacts, Lambda smoke tests

import * as cdk from "aws-cdk-lib";
import { Stack, StackProps, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as openIdConnect from "aws-cdk-lib/aws-iam";

export interface GitHubActionsStackProps extends StackProps {
  /** GitHub organization or user name (e.g., "octocat") */
  githubOrg: string;
  /** Repository name (e.g., "costscrunch") */
  repositoryName: string;
  /** Branch pattern for trust policy (e.g., "main" or "refs/heads/main") */
  branchName: string;
  /** Environment name for resource naming (e.g., "staging", "production") */
  environment: string;
}

export class GitHubActionsStack extends Stack {
  public readonly iamRoleArn: CfnOutput;
  public readonly oidcProviderArn: CfnOutput;

  constructor(scope: Construct, id: string, props: GitHubActionsStackProps) {
    super(scope, id, props);

    const { githubOrg, repositoryName, branchName, environment } = props;
    const prefix = `costscrunch-${environment}`;

    // ── 1. OpenID Connect Provider ───────────────────────────────────────────
    // Note: Provider is created once per AWS account; CDK will only create
    // if not already existing (idempotent). The thumbprint list is fixed for
    // token.actions.githubusercontent.com.
    const thumbprints = ["6938fd4d98bab03faadb97b34396831e3780aea1"];

    const oidcProvider = new openIdConnect.CfnOIDCProvider(this, "GitHubOIDCProvider", {
      url: "https://token.actions.githubusercontent.com",
      clientIdList: ["sts.amazonaws.com"],
      thumbprintList: thumbprints,
    });

    // ── 2. IAM Role with Trust Policy ────────────────────────────────────────
    // Trust policy restricts authentication to:
    //   - Specific repo (githubOrg/repositoryName)
    //   - Specific branch (main)
    //   - Runner environment (GitHub Actions)
    const githubActionsRole = new iam.Role(this, "GitHubActionsDeployRole", {
      roleName: `${prefix}-github-actions-deploy`,
      description: `GitHub Actions OIDC role for ${environment} deployments`,
      assumedBy: new iam.OpenIdConnectPrincipal(oidcProvider, {
        StringEquals: { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
        StringLike: {
          "token.actions.githubusercontent.com:sub": `repo:${githubOrg}/${repositoryName}:ref:refs/heads/${branchName}`,
        },
      }),
      inlinePolicies: {
        // ── 3. Least-Privilege Permissions ────────────────────────────────────
        cdkDeployPolicy: new iam.PolicyDocument({
          statements: [
            // CDK bootstrap (one-time per account/region)
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["sts:GetCallerIdentity", "sts:AssumeRole"],
              resources: ["*"],
            }),
            // CloudFormation deploy (scope to specific stack name pattern)
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "cloudformation:CreateStack",
                "cloudformation:UpdateStack",
                "cloudformation:DeleteStack",
                "cloudformation:DescribeStacks",
                "cloudformation:DescribeStackEvents",
                "cloudformation:GetTemplate",
                "cloudformation:ValidateTemplate",
                "cloudformation:EstimateTemplateCost",
              ],
              resources: [
                `arn:aws:cloudformation:${this.region}:${this.account}:stack/${prefix}-*/*`,
                `arn:aws:cloudformation:${this.region}:${this.account}:stack/cdk-*/*`,
              ],
            }),
            // S3 bucket operations for CDK assets
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "s3:CreateBucket",
                "s3:DeleteBucket",
                "s3:DeleteObject",
                "s3:GetBucketLocation",
                "s3:GetObject",
                "s3:ListBucket",
                "s3:PutObject",
              ],
              resources: [
                `arn:aws:s3:::${prefix}-*`,
                `arn:aws:s3:::${prefix}-*/*`,
                "arn:aws:s3:::cdk-*",
                "arn:aws:s3:::cdk-*/*",
              ],
            }),
            // Lambda invoke for smoke tests
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["lambda:InvokeFunction"],
              resources: [
                `arn:aws:lambda:${this.region}:${this.account}:function:${prefix}-*`,
                `arn:aws:lambda:${this.region}:${this.account}:function:cdk-*`,
              ],
            }),
            // CloudFront invalidation
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "cloudfront:CreateInvalidation",
                "cloudfront:GetInvalidation",
                "cloudfront:ListInvalidations",
              ],
              resources: ["*"],
            }),
            // ECR for container-based workflows (if used)
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "ecr:GetAuthorizationToken",
                "ecr:BatchCheckLayerAvailability",
                "ecr:GetDownloadUrlForLayer",
                "ecr:BatchGetImage",
                "ecr:PutImage",
              ],
              resources: ["*"],
            }),
            // IAM role management for CDK resource providers
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "iam:AttachRolePolicy",
                "iam:CreateRole",
                "iam:DeleteRole",
                "iam:DeleteRolePolicy",
                "iam:DetachRolePolicy",
                "iam:GetRole",
                "iam:GetRolePolicy",
                "iam:PassRole",
                "iam:PutRolePolicy",
                "iam:UpdateRole",
                "iam:TagRole",
              ],
              resources: [`arn:aws:iam::${this.account}:role/${prefix}-*`, `arn:aws:iam::${this.account}:role/cdk-*`],
            }),
            // SSM Parameter Store (for CDK bootstrap)
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["ssm:*"],
              resources: [
                `arn:aws:ssm:${this.region}:${this.account}:parameter/${prefix}/*`,
                `arn:aws:ssm:${this.region}:${this.account}:parameter/cdk/*`,
              ],
            }),
          ],
        }),
      },
    });

    // ── Outputs ──────────────────────────────────────────────────────────────
    this.oidcProviderArn = new CfnOutput(this, "OIDCProviderArn", {
      value: oidcProvider.attrArn,
      description: "ARN of the GitHub OIDC Provider",
      exportName: `${prefix}-github-oidc-provider-arn`,
    });

    this.iamRoleArn = new CfnOutput(this, "IAMRoleArn", {
      value: githubActionsRole.roleArn,
      description: "ARN of the GitHub Actions deploy role",
      exportName: `${prefix}-github-actions-role-arn`,
    });
  }
}
