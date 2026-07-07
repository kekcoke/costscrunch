import { StackProps } from "aws-cdk-lib";
import * as kms from "aws-cdk-lib/aws-kms";
import { AlarmThreshold } from "./CostsCrunchStack";
import { StackConfig } from "./StackConfig";

export interface CostsCrunchStackProps extends StackProps {
  environment: "dev" | "staging" | "prod";
  domainName?: string;
  config?: StackConfig;
  /** DynamoDB and Lambda capacity mode: on-demand or provisioned */
  capacityMode?: "on-demand" | "provisioned";
  /** CloudWatch alarm thresholds */
  alarmThreshold?: AlarmThreshold;
  /** Enable Lambda provisioned concurrency for critical functions */
  provisionedConcurrency?: boolean;
  /** Removal policy for resources (destroy for dev, retain for prod) */
  removalPolicy?: "destroy" | "retain";
  /**
   * Externally-provisioned KMS key to use instead of creating one inline
   * (prod: the multi-Region key from `KmsKeyStack`, required so a Global
   * Table replica in us-west-2 can be encrypted with a CMK). When omitted,
   * the stack creates its own single-Region key, as dev/staging do.
   */
  externalKmsKey?: kms.IKey;
  /**
   * Region -> KMS key ARN map for MainTable's Global Table replicas. Required
   * alongside `externalKmsKey` whenever `environment === "prod"` — see
   * `DataConstruct` and `KmsReplicaStack`.
   */
  replicaKeyArns?: { [region: string]: string };
}
