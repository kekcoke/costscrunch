import { Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as kms from "aws-cdk-lib/aws-kms";

export interface KmsReplicaStackProps extends StackProps {
  prefix: string;
  /** ARN of the multi-Region primary key (from KmsKeyStack) to replicate. */
  primaryKeyArn: string;
}

/**
 * Physical us-west-2 replica of the multi-Region primary key created by
 * KmsKeyStack. DynamoDB Global Table replicas that use a customer-managed
 * key require a key that already exists in the replica's own region — see
 * `DataConstruct` / `replicaKeyArns`. This stack must be deployed (a) after
 * KmsKeyStack (needs the primary key's ARN) and (b) before CostsCrunchStack,
 * whose MainTable references this replica key's ARN when it provisions the
 * us-west-2 table replica. Deploy order (b) is enforced via an explicit
 * `mainStack.addDependency(kmsReplicaStack)` in `bin/costscrunch.ts` — see
 * that file and `KmsKeyStack` for the full explanation of why the primary
 * key isn't just created inline inside CostsCrunchStack.
 */
export class KmsReplicaStack extends Stack {
  public readonly replicaKeyArn: string;

  constructor(scope: Construct, id: string, props: KmsReplicaStackProps) {
    super(scope, id, props);
    const { prefix, primaryKeyArn } = props;

    // Mirrors the default key policy aws-cdk-lib's `kms.Key` generates
    // (account root gets full kms:* — grants to specific principals are
    // then made via IAM policies, same pattern as the primary key).
    const keyPolicy = new iam.PolicyDocument({
      statements: [
        new iam.PolicyStatement({
          sid: "EnableAccountRootAdmin",
          effect: iam.Effect.ALLOW,
          principals: [new iam.AccountRootPrincipal()],
          actions: ["kms:*"],
          resources: ["*"],
        }),
      ],
    });

    const replicaKey = new kms.CfnReplicaKey(this, "CostsCrunchKeyReplica", {
      primaryKeyArn,
      description: `Replica of ${prefix} primary KMS key (us-west-2) — DynamoDB Global Table replica encryption`,
      keyPolicy,
    });

    this.replicaKeyArn = replicaKey.attrArn;
  }
}
