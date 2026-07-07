import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as elasticache from "aws-cdk-lib/aws-elasticache";

export interface NetworkConstructProps {
  prefix: string;
  isProd: boolean;
}

export class NetworkConstruct extends Construct {
  public readonly vpc: ec2.Vpc;
  public readonly lambdaSg: ec2.SecurityGroup;
  public readonly redis: elasticache.CfnReplicationGroup;

  constructor(scope: Construct, id: string, props: NetworkConstructProps) {
    super(scope, id);
    const { prefix, isProd } = props;

    this.vpc = new ec2.Vpc(this, "CostsCrunchVPC", {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        { name: "public",   subnetType: ec2.SubnetType.PUBLIC,              cidrMask: 24 },
        { name: "private",  subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
        { name: "isolated", subnetType: ec2.SubnetType.PRIVATE_ISOLATED,    cidrMask: 28 },
      ],
      gatewayEndpoints: {
        S3:       { service: ec2.GatewayVpcEndpointAwsService.S3 },
        DynamoDB: { service: ec2.GatewayVpcEndpointAwsService.DYNAMODB },
      },
    });

    // Interface endpoints keep service traffic off the public internet.
    const vpcInterfaceServices = [
      { svc: ec2.InterfaceVpcEndpointAwsService.SSM,             id: "SSM" },
      { svc: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER, id: "SecretsManager" },
      { svc: ec2.InterfaceVpcEndpointAwsService.SQS,             id: "SQS" },
      { svc: ec2.InterfaceVpcEndpointAwsService.SNS,             id: "SNS" },
      { svc: ec2.InterfaceVpcEndpointAwsService.EVENTBRIDGE,     id: "EventBridge" },
    ];

    for (const { svc, id } of vpcInterfaceServices) {
      new ec2.InterfaceVpcEndpoint(this, `Endpoint${id}`, {
        vpc: this.vpc,
        service: svc,
        privateDnsEnabled: true,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      });
    }

    const redisSg = new ec2.SecurityGroup(this, "RedisSg", {
      vpc: this.vpc,
      description: "Redis SG",
    });

    this.lambdaSg = new ec2.SecurityGroup(this, "LambdaSg", {
      vpc: this.vpc,
      description: "Shared Lambda SG",
      allowAllOutbound: true,
    });

    // IaC-003: allow all Lambda functions to reach Redis on 6379.
    redisSg.addIngressRule(this.lambdaSg, ec2.Port.tcp(6379), "Lambda to Redis");

    const redisSubnetGroup = new elasticache.CfnSubnetGroup(this, "RedisSubnets", {
      cacheSubnetGroupName: `${prefix}-redis-subnets`,
      description: "Subnet group for Redis cluster",
      subnetIds: this.vpc.isolatedSubnets.map(s => s.subnetId),
    });

    this.redis = new elasticache.CfnReplicationGroup(this, "Redis", {
      replicationGroupDescription: `${prefix} Redis`,
      cacheNodeType:              isProd ? "cache.t4g.small" : "cache.t2.micro",
      engine:                     "redis",
      engineVersion:              "7.0",
      numCacheClusters:           isProd ? 2 : 1,
      automaticFailoverEnabled:   isProd,
      multiAzEnabled:             true,
      atRestEncryptionEnabled:    true,
      transitEncryptionEnabled:   true,
      cacheSubnetGroupName:       redisSubnetGroup.cacheSubnetGroupName!,
      securityGroupIds:           [redisSg.securityGroupId],
    });
  }
}
