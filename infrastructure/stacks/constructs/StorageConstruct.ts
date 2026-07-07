import { Construct } from "constructs";
import { Duration, RemovalPolicy } from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as kms from "aws-cdk-lib/aws-kms";

export interface StorageConstructProps {
  prefix: string;
  isProd: boolean;
  accountId: string;
  kmsKey: kms.IKey;
  viteAppUrl: string;
  removalPolicy: RemovalPolicy;
}

export class StorageConstruct extends Construct {
  public readonly uploadsBucket: s3.Bucket;
  public readonly processedBucket: s3.Bucket;
  public readonly receiptsBucket: s3.Bucket;
  public readonly assetsBucket: s3.Bucket;
  public readonly quarantineBucket: s3.CfnBucket;

  constructor(scope: Construct, id: string, props: StorageConstructProps) {
    super(scope, id);
    const { prefix, isProd, accountId, kmsKey, viteAppUrl, removalPolicy } = props;

    this.uploadsBucket = new s3.Bucket(this, "UploadsBucket", {
      bucketName: `${prefix}-uploads-${accountId}`,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: kmsKey,
      versioned: false,
      enforceSSL: true,
      removalPolicy,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.POST, s3.HttpMethods.GET],
          allowedOrigins: isProd ? [viteAppUrl] : ["*"],
          allowedHeaders: ["*"],
          maxAge: 3600,
        },
      ],
      lifecycleRules: [{ expiration: Duration.days(3) }],
    });

    this.processedBucket = new s3.Bucket(this, "ProcessedBucket", {
      bucketName: `${prefix}-processed-${accountId}`,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: kmsKey,
      versioned: true,
      enforceSSL: true,
      removalPolicy,
      lifecycleRules: [
        {
          transitions: [
            { storageClass: s3.StorageClass.INTELLIGENT_TIERING, transitionAfter: Duration.days(15) },
          ],
          expiration: Duration.days(30),
          noncurrentVersionExpiration: Duration.days(7),
        },
      ],
    });

    this.receiptsBucket = new s3.Bucket(this, "ReceiptsBucket", {
      bucketName: `${prefix}-receipts-${accountId}`,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: kmsKey,
      versioned: true,
      enforceSSL: true,
      removalPolicy,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET],
          allowedOrigins: isProd ? [viteAppUrl] : ["*"],
          allowedHeaders: ["*"],
          maxAge: 3600,
        },
      ],
      lifecycleRules: [
        {
          transitions: [
            { storageClass: s3.StorageClass.INTELLIGENT_TIERING, transitionAfter: Duration.days(15) },
          ],
        },
        { expiration: Duration.days(30), noncurrentVersionExpiration: Duration.days(7) },
      ],
    });

    this.assetsBucket = new s3.Bucket(this, "AssetsBucket", {
      bucketName: `${prefix}-assets-${accountId}`,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: kmsKey,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy,
    });

    // Quarantine bucket: stores unreadable/corrupt/invalid files from image-preprocess.
    // Uses CfnBucket for expirationInSeconds (not available on L2 Bucket).
    this.quarantineBucket = new s3.CfnBucket(this, "QuarantineBucket", {
      bucketName: `${prefix}-quarantine-${accountId}`,
      versioningConfiguration: { status: "Disabled" },
      bucketEncryption: {
        serverSideEncryptionConfiguration: [
          {
            serverSideEncryptionRule: {
              applyServerSideEncryptionByDefault: {
                sSEAlgorithm: "aws:kms",
                sSEKMSKeyId: kmsKey.keyId,
              },
            },
          },
        ],
      },
      lifecycleConfiguration: {
        rules: [{ expirationInSeconds: 18000, status: "Enabled" }],
      },
    } as any);
    this.quarantineBucket.applyRemovalPolicy(removalPolicy);
  }
}
