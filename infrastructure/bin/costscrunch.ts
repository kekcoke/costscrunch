#!/usr/bin/env node
/**
 * CostsCrunch CDK Entry Point
 * 
 * Usage:
 *   npx cdk deploy --all                           # Deploy based on --context.stage
 *   npx cdk deploy --all -c stage=staging         # Deploy staging
 *   npx cdk deploy --all -c stage=prod           # Deploy production
 *   npx cdk synth                                 # Synthesize templates
 * 
 * Environment Variables:
 *   CDK_DEFAULT_ACCOUNT  - AWS account ID
 *   CDK_DEFAULT_REGION   - AWS region
 */

import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import * as kms from "aws-cdk-lib/aws-kms";
import { CostsCrunchStack } from "../stacks/CostsCrunchStack";
import { GitHubActionsStack } from "../stacks/GitHubActionsStack";
import { KmsKeyStack } from "../stacks/KmsKeyStack";
import { KmsReplicaStack } from "../stacks/KmsReplicaStack";
import { buildStackConfig } from "../stacks/StackConfig";

// DynamoDB Global Table replica region for prod (see DataConstruct / KmsKeyStack).
const GLOBAL_TABLE_REPLICA_REGION = "us-west-2";

interface StageConfig {
  stage: "dev" | "staging" | "prod";
  capacityMode: "on-demand" | "provisioned";
  alarmThreshold: {
    errorRate: number;
    durationP99: number; // milliseconds
  };
  provisionedConcurrency: boolean;
  removalPolicy?: "destroy" | "retain";
}

function getStageConfig(app: cdk.App): StageConfig {
  const stageContext = app.node.tryGetContext("stage") || "dev";
  
  const defaults: StageConfig = {
    stage: "dev",
    capacityMode: "on-demand",
    alarmThreshold: { errorRate: 5, durationP99: 30000 },
    provisionedConcurrency: false,
    removalPolicy: "destroy",
  };

  const stageConfigs: Record<string, Partial<StageConfig>> = {
    dev: {
      stage: "dev",
      capacityMode: "on-demand",
      alarmThreshold: { errorRate: 5, durationP99: 30000 },
      provisionedConcurrency: false,
      removalPolicy: "destroy",
    },
    staging: {
      stage: "staging",
      capacityMode: "on-demand",
      alarmThreshold: { errorRate: 3, durationP99: 20000 },
      provisionedConcurrency: false,
      removalPolicy: "retain",
    },
    prod: {
      stage: "prod",
      capacityMode: "provisioned",
      alarmThreshold: { errorRate: 1, durationP99: 10000 },
      provisionedConcurrency: true,
      removalPolicy: "retain",
    },
  };

  return { ...defaults, ...stageConfigs[stageContext] };
}

const app = new cdk.App();

// Resolve environment info
const account = process.env.CDK_DEFAULT_ACCOUNT;
const region = process.env.CDK_DEFAULT_REGION;

// Get stage configuration
const stageConfig = getStageConfig(app);
const { stage, capacityMode, alarmThreshold, provisionedConcurrency, removalPolicy } = stageConfig;

// Build configuration (handles test fallbacks)
const config = buildStackConfig(app, account ?? "123456789012", region ?? "us-east-1");

// ── KMS Foundation (prod only) ────────────────────────────────────────────────
// prod replicates the MainTable to us-west-2 (DataConstruct), which requires a
// customer-managed KMS key that already exists in that region. See KmsKeyStack
// and KmsReplicaStack for why this is two separate stacks (and not just an
// inline key in CostsCrunchStack): it avoids a circular dependency between the
// main stack and the replica-key stack while still deploying the replica key
// before the main stack needs it.
let externalKmsKey: kms.IKey | undefined;
let replicaKeyArns: { [region: string]: string } | undefined;
let kmsReplicaStack: KmsReplicaStack | undefined;

if (stage === "prod") {
  const primaryRegion = region ?? "us-east-1";

  const kmsKeyStack = new KmsKeyStack(app, `costscrunch-${stage}-kms`, {
    prefix: `costscrunch-${stage}`,
    removalPolicy,
    env: { account, region: primaryRegion },
    // Required on both sides of a cross-region reference: kmsReplicaStack
    // (us-west-2) reads this stack's (primaryRegion) key ARN.
    crossRegionReferences: true,
  });

  kmsReplicaStack = new KmsReplicaStack(app, `costscrunch-${stage}-kms-replica`, {
    prefix: `costscrunch-${stage}`,
    primaryKeyArn: kmsKeyStack.key.keyArn,
    env: { account, region: GLOBAL_TABLE_REPLICA_REGION },
    crossRegionReferences: true,
  });

  externalKmsKey = kmsKeyStack.key;
  // Multi-Region keys share the same key ID across every replica region, so
  // the us-west-2 replica's ARN can be derived directly from the primary key
  // ID without a reference back to kmsReplicaStack (which would recreate the
  // circular dependency KmsKeyStack/KmsReplicaStack exist to avoid).
  replicaKeyArns = {
    [GLOBAL_TABLE_REPLICA_REGION]: cdk.Arn.format(
      {
        region: GLOBAL_TABLE_REPLICA_REGION,
        service: "kms",
        resource: "key",
        resourceName: kmsKeyStack.key.keyId,
      },
      kmsKeyStack,
    ),
  };
}

// ── Main Application Stack ───────────────────────────────────────────────────────
const mainStack = new CostsCrunchStack(app, `costscrunch-${stage}`, {
  environment: stage,
  capacityMode,
  alarmThreshold,
  provisionedConcurrency,
  removalPolicy,
  env: { account, region },
  config,
  externalKmsKey,
  replicaKeyArns,
});

if (kmsReplicaStack) {
  // Ensure the physical us-west-2 replica key exists before the MainTable's
  // Global Table replica is created — CDK can't infer this ordering on its
  // own because mainStack references the replica key only by ARN string,
  // not via a token from kmsReplicaStack (see comment above).
  mainStack.addDependency(kmsReplicaStack);
}

// ── GitHub Actions OIDC Stack (staging/prod only) ─────────────────────────────
const githubOrg = process.env.GITHUB_ORG;
const repositoryName = process.env.GITHUB_REPO;

if (githubOrg && repositoryName && stage !== "dev") {
  new GitHubActionsStack(app, `github-actions-${stage}`, {
    githubOrg,
    repositoryName,
    branchName: stage === "prod" ? "main" : stage,
    environment: stage,
    env: { account, region },
  });
}

// Tag all resources with stage information
cdk.Tags.of(app).add("Environment", stage);
cdk.Tags.of(app).add("Application", "CostsCrunch");
cdk.Tags.of(app).add("ManagedBy", "CDK");

// Print stack info
console.log(`\n📦 CostsCrunch CDK Synthesis`);
console.log(`   Stage: ${stage}`);
console.log(`   Capacity: ${capacityMode}`);
console.log(`   Provisioned Concurrency: ${provisionedConcurrency}`);
console.log(`   Alarm Error Rate: ${alarmThreshold.errorRate}%`);
console.log(`   Alarm Duration P99: ${alarmThreshold.durationP99}ms`);
console.log(`   Removal Policy: ${removalPolicy}`);
console.log(`   Account: ${account ?? "default"}`);
console.log(`   Region: ${region ?? "default"}\n`);
