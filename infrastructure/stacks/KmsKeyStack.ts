import { Stack, StackProps, RemovalPolicy } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as kms from "aws-cdk-lib/aws-kms";

export interface KmsKeyStackProps extends StackProps {
  prefix: string;
  /** "retain" for prod (matches CostsCrunchStack's removalPolicy convention). */
  removalPolicy?: "destroy" | "retain";
}

/**
 * Owns the primary multi-Region customer-managed KMS key used by prod.
 *
 * Why this is its own stack (rather than an inline `new kms.Key(...)` inside
 * CostsCrunchStack, as dev/staging still do): a DynamoDB Global Table replica
 * in us-west-2 needs a KMS key that already physically exists in us-west-2
 * (`replicaKeyArns` — see DataConstruct). That replica key (KmsReplicaStack)
 * must reference this primary key's ARN, which means KmsReplicaStack depends
 * on this stack. For the real AWS deploy to succeed, KmsReplicaStack must
 * also finish deploying *before* CostsCrunchStack's MainTable tries to
 * provision its us-west-2 replica — if the primary key lived inside
 * CostsCrunchStack itself, that would require CostsCrunchStack to depend on
 * KmsReplicaStack while KmsReplicaStack simultaneously depends on
 * CostsCrunchStack for the primary key ARN: a circular dependency CDK cannot
 * express. Splitting the primary key out breaks the cycle:
 *
 *   KmsKeyStack -> KmsReplicaStack -> CostsCrunchStack (explicit addDependency)
 *   KmsKeyStack -----------------------> CostsCrunchStack (direct key import)
 *
 * See `bin/costscrunch.ts` for how the three stacks are wired together.
 */
export class KmsKeyStack extends Stack {
  public readonly key: kms.Key;

  constructor(scope: Construct, id: string, props: KmsKeyStackProps) {
    super(scope, id, props);
    const { prefix, removalPolicy } = props;

    this.key = new kms.Key(this, "CostsCrunchKey", {
      alias: `${prefix}-main`,
      enableKeyRotation: true,
      description:
        "Primary KMS encryption key (multi-Region: replicated to us-west-2 for the MainTable Global Table replica)",
      removalPolicy: removalPolicy === "retain" ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      multiRegion: true,
    });
  }
}
