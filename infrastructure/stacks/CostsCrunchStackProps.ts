import { StackProps } from "aws-cdk-lib";
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
}
