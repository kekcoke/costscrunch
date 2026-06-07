import { Construct } from "constructs";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";

export interface ConfigConstructProps {
  prefix: string;
  isProd: boolean;
}

export class ConfigConstruct extends Construct {
  public readonly bedrockModelIdParam: ssm.StringParameter;
  public readonly viteAppUrlParam: ssm.StringParameter;
  public readonly notificationSecret: secretsmanager.Secret;
  public readonly viteAppUrl: string;

  constructor(scope: Construct, id: string, props: ConfigConstructProps) {
    super(scope, id);
    const { prefix, isProd } = props;

    this.bedrockModelIdParam = new ssm.StringParameter(this, "BedrockModelId", {
      parameterName: `/${prefix}/bedrock-model-id`,
      stringValue: process.env.BEDROCK_MODEL_ID ?? "foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0",
      tier: ssm.ParameterTier.STANDARD,
    });

    this.viteAppUrlParam = new ssm.StringParameter(this, "ViteAppUrl", {
      parameterName: `/${prefix}/vite-app-url`,
      stringValue: process.env.VITE_APP_URL ?? "https://app.costscrunch.io",
      tier: ssm.ParameterTier.STANDARD,
    });

    this.notificationSecret = new secretsmanager.Secret(this, "NotificationSecret", {
      secretName: `${prefix}/notification-config`,
      description: "Notification service configuration (email, Pinpoint)",
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          fromEmail: "noreply@costscrunch.com",
          pinpointAppId: isProd ? "REPLACE_WITH_ACTUAL_ID" : "dummy-pinpoint-id",
        }),
        generateStringKey: "unused",
      },
    });

    new ssm.StringParameter(this, "FromEmail", {
      parameterName: `/${prefix}/from-email`,
      stringValue: "noreply@costscrunch.com",
      description: "Default sender email for SES notifications",
    });

    new ssm.StringParameter(this, "PinpointAppId", {
      parameterName: `/${prefix}/pinpoint-app-id`,
      stringValue: isProd ? "REPLACE_WITH_ACTUAL_ID" : "dummy-pinpoint-id",
      description: "AWS Pinpoint application ID for push notifications",
    });

    // Expose the resolved string value for use in CORS and OAuth callback URLs.
    // This reads the SSM token — it resolves at synth time from the parameter's stringValue prop.
    this.viteAppUrl = this.viteAppUrlParam.stringValue;
  }
}
