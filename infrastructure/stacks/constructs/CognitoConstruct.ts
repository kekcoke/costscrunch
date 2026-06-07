import { Construct } from "constructs";
import { Duration, RemovalPolicy } from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";

export interface CognitoConstructProps {
  prefix: string;
  isProd: boolean;
  viteAppUrl: string;
  removalPolicy: RemovalPolicy;
}

export class CognitoConstruct extends Construct {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props: CognitoConstructProps) {
    super(scope, id);
    const { prefix, isProd, viteAppUrl, removalPolicy } = props;

    this.userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName: `${prefix}-users`,
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      mfa: isProd ? cognito.Mfa.REQUIRED : cognito.Mfa.OFF,
      mfaSecondFactor: { sms: true, otp: true },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: Duration.days(7),
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      standardAttributes: {
        email:    { required: true, mutable: false },
        fullname: { required: true, mutable: true },
      },
      customAttributes: {
        plan:  new cognito.StringAttribute({ mutable: true }),
        orgId: new cognito.StringAttribute({ mutable: true }),
      },
      removalPolicy,
      standardThreatProtectionMode: cognito.StandardThreatProtectionMode.FULL_FUNCTION,
    });

    this.userPoolClient = this.userPool.addClient("WebClient", {
      userPoolClientName: `${prefix}-web`,
      authFlows: {
        userSrp:      true,
        userPassword: false,
      },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.EMAIL, cognito.OAuthScope.OPENID, cognito.OAuthScope.PROFILE],
        callbackUrls: isProd ? [`${viteAppUrl}/callback`] : ["http://localhost:3000/callback"],
        logoutUrls:   isProd ? [`${viteAppUrl}/logout`]   : ["http://localhost:3000/logout"],
      },
      accessTokenValidity:          Duration.minutes(15),
      refreshTokenValidity:         Duration.days(30),
      preventUserExistenceErrors:   true,
      enableTokenRevocation:        true,
    });

    new cognito.CfnUserPoolGroup(this, "AdminGroup",    { userPoolId: this.userPool.userPoolId, groupName: "admins",   precedence: 1 });
    new cognito.CfnUserPoolGroup(this, "SupportGroup",  { userPoolId: this.userPool.userPoolId, groupName: "support",  precedence: 2 });
    new cognito.CfnUserPoolGroup(this, "BusinessGroup", { userPoolId: this.userPool.userPoolId, groupName: "business", precedence: 3 });
    new cognito.CfnUserPoolGroup(this, "ProGroup",      { userPoolId: this.userPool.userPoolId, groupName: "pro",      precedence: 4 });
    new cognito.CfnUserPoolGroup(this, "FreeGroup",     { userPoolId: this.userPool.userPoolId, groupName: "free",     precedence: 5 });
  }
}
