import { Construct } from "constructs";
import { RemovalPolicy, CfnOutput } from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as kms from "aws-cdk-lib/aws-kms";

export interface DataConstructProps {
  prefix: string;
  isProd: boolean;
  kmsKey: kms.IKey;
  capacityMode: "on-demand" | "provisioned";
  removalPolicy: RemovalPolicy;
  /**
   * Region -> KMS key ARN map for the MainTable's Global Table replicas.
   * Required whenever `replicas` below is non-empty and the table uses a
   * customer-managed key: DynamoDB cannot reference a CMK across regions
   * without an explicit ARN (see IaC bug: "KMS key for us-west-2 was not
   * found in 'replicaKeyArns'"). Populated by the caller from a companion
   * KMS replica stack — see `bin/costscrunch.ts` and `KmsReplicaStack`.
   */
  replicaKeyArns?: { [region: string]: string };
}

export class DataConstruct extends Construct {
  public readonly table: dynamodb.TableV2;
  public readonly connTable: dynamodb.TableV2;

  constructor(scope: Construct, id: string, props: DataConstructProps) {
    super(scope, id);
    const { prefix, isProd, kmsKey, capacityMode, removalPolicy, replicaKeyArns } = props;

    this.table = new dynamodb.TableV2(this, "MainTable", {
      tableName: `${prefix}-main`,
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billing: capacityMode === "provisioned"
        ? dynamodb.Billing.provisioned({
            readCapacity: dynamodb.Capacity.fixed(isProd ? 50 : 5),
            writeCapacity: dynamodb.Capacity.autoscaled({ maxCapacity: isProd ? 20 : 5 }),
          })
        : dynamodb.Billing.onDemand(),
      encryption: dynamodb.TableEncryptionV2.customerManagedKey(kmsKey, replicaKeyArns),
      pointInTimeRecovery: true,
      deletionProtection: isProd,
      timeToLiveAttribute: "ttl",
      removalPolicy,
      replicas: isProd ? [{ region: "us-west-2" }] : [],
      globalSecondaryIndexes: [
        {
          indexName: "GSI1",
          partitionKey: { name: "gsi1pk", type: dynamodb.AttributeType.STRING },
          sortKey: { name: "gsi1sk", type: dynamodb.AttributeType.STRING },
        },
        {
          indexName: "GSI2",
          partitionKey: { name: "gsi2pk", type: dynamodb.AttributeType.STRING },
          sortKey: { name: "gsi2sk", type: dynamodb.AttributeType.STRING },
        },
        {
          indexName: "ReceiptHashIndex",
          partitionKey: { name: "receiptHash", type: dynamodb.AttributeType.STRING },
          projectionType: dynamodb.ProjectionType.ALL,
        },
      ],
    });

    // Stores active API Gateway WebSocket connectionIds keyed by userId.
    this.connTable = new dynamodb.TableV2(this, "ConnTable", {
      tableName:     `${prefix}-connections`,
      partitionKey:  { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey:       { name: "sk", type: dynamodb.AttributeType.STRING },
      billing:       dynamodb.Billing.onDemand(),
      encryption:    dynamodb.TableEncryptionV2.customerManagedKey(kmsKey),
      timeToLiveAttribute: "ttl",
      removalPolicy,
    });

    new CfnOutput(this, "MainTableCostNote", {
      value: "Estimated $3-5/mo for 10K writes/50K reads daily (On-Demand)",
      description: "Cost note for MainTable launch capacity",
    });
    new CfnOutput(this, "ConnTableCostNote", {
      value: "Estimated <$1/mo for connection management (On-Demand)",
      description: "Cost note for ConnTable launch capacity",
    });
  }
}
