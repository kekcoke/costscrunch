#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { CostsCrunchStack } from "../stacks/CostsCrunchStack";
import { GitHubActionsStack } from "../stacks/GitHubActionsStack";
import { buildStackConfig } from "../stacks/StackConfig";

const app = new cdk.App();

const envContext = (app.node.tryGetContext("env") || "dev") as "dev" | "staging" | "prod";

// Resolve environment info
const account = process.env.CDK_DEFAULT_ACCOUNT;
const region = process.env.CDK_DEFAULT_REGION;

// Build configuration (handles test fallbacks)
const config = buildStackConfig(app, account, region);

// Main application stack
new CostsCrunchStack(app, `costscrunch-${envContext}`, {
  environment: envContext,
  env: { account, region },
  config,
});

// GitHub Actions OIDC stack (only deploy if GitHub configuration is provided)
const githubOrg = process.env.GITHUB_ORG;
const repositoryName = process.env.GITHUB_REPO;

if (githubOrg && repositoryName && envContext !== "dev") {
  new GitHubActionsStack(app, `github-actions-${envContext}`, {
    githubOrg,
    repositoryName,
    branchName: envContext === "prod" ? "main" : envContext,
    environment: envContext,
    env: { account, region },
  });
}
