import { Construct } from "constructs";
import { Duration } from "aws-cdk-lib";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as apigwv2Integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as apigwv2Authorizers from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { ComputeConstruct } from "./ComputeConstruct";
import { StackConfig } from "../StackConfig";

export interface ApiConstructProps {
  prefix: string;
  isProd: boolean;
  viteAppUrl: string;
  userPool: cognito.UserPool;
  compute: ComputeConstruct;
  config: StackConfig;
}

export class ApiConstruct extends Construct {
  public readonly httpApi: apigwv2.HttpApi;
  public readonly wsApi: apigwv2.WebSocketApi;
  public readonly wsStage: apigwv2.WebSocketStage;
  public readonly wsCallbackUrl: string;

  constructor(scope: Construct, id: string, props: ApiConstructProps) {
    super(scope, id);
    const { prefix, isProd, viteAppUrl, userPool, compute, config } = props;

    const CORS_ALLOW_ORIGINS = isProd ? [viteAppUrl] : ["*"];
    const CORS_ALLOW_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
    const CORS_ALLOW_HEADERS = ["Authorization", "Content-Type", "X-Idempotency-Key"];

    const authorizer = new apigwv2Authorizers.HttpUserPoolAuthorizer("CognitoAuthorizer", userPool, {
      authorizerName: `${prefix}-authorizer`,
      identitySource: ["$request.header.Authorization"],
    });

    this.httpApi = new apigwv2.HttpApi(this, "Api", {
      apiName: `${prefix}-api`,
      corsPreflight: {
        allowOrigins: CORS_ALLOW_ORIGINS,
        allowMethods: CORS_ALLOW_METHODS.map(m =>
          apigwv2.CorsHttpMethod[m as keyof typeof apigwv2.CorsHttpMethod],
        ),
        allowHeaders: CORS_ALLOW_HEADERS,
        maxAge: Duration.hours(24),
      },
    });

    const addRoute = (method: apigwv2.HttpMethod, routePath: string, fn: lambda.Function) => {
      const integrationId = `${fn.node.id}${method}Integration`;
      this.httpApi.addRoutes({
        path: routePath,
        methods: [method],
        integration: new apigwv2Integrations.HttpLambdaIntegration(integrationId, fn),
        authorizer,
      });
    };

    // Expense routes
    addRoute(apigwv2.HttpMethod.GET,    "/expenses",                  compute.expensesLambda);
    addRoute(apigwv2.HttpMethod.GET,    "/expenses/export",           compute.expenseExportLambda);
    addRoute(apigwv2.HttpMethod.POST,   "/expenses",                  compute.expensesLambda);
    addRoute(apigwv2.HttpMethod.GET,    "/expenses/{id}",             compute.expensesLambda);
    addRoute(apigwv2.HttpMethod.PATCH,  "/expenses/{id}",             compute.expensesLambda);
    addRoute(apigwv2.HttpMethod.DELETE, "/expenses/{id}",             compute.expensesLambda);

    // Group routes
    addRoute(apigwv2.HttpMethod.GET,    "/groups",                             compute.groupsLambda);
    addRoute(apigwv2.HttpMethod.POST,   "/groups",                             compute.groupsLambda);
    addRoute(apigwv2.HttpMethod.GET,    "/groups/{id}",                        compute.groupsLambda);
    addRoute(apigwv2.HttpMethod.PATCH,  "/groups/{id}",                        compute.groupsLambda);
    addRoute(apigwv2.HttpMethod.GET,    "/groups/{id}/balances",               compute.groupsLambda);
    addRoute(apigwv2.HttpMethod.POST,   "/groups/{id}/settle",                 compute.groupsLambda);
    addRoute(apigwv2.HttpMethod.POST,   "/groups/{id}/join",                   compute.groupsLambda);
    addRoute(apigwv2.HttpMethod.POST,   "/groups/{id}/members",                compute.groupsLambda);
    addRoute(apigwv2.HttpMethod.DELETE, "/groups/{id}/members/{userId}",       compute.groupsLambda);

    // Receipt routes
    addRoute(apigwv2.HttpMethod.POST,   "/receipts/upload-url",                compute.receiptsLambda);
    addRoute(apigwv2.HttpMethod.GET,    "/receipts/{expenseId}/scan",          compute.receiptsLambda);
    addRoute(apigwv2.HttpMethod.GET,    "/receipts/{expenseId}/download",      compute.receiptsLambda);

    // Analytics & health
    addRoute(apigwv2.HttpMethod.GET,    "/analytics/summary",                  compute.analyticsLambda);
    addRoute(apigwv2.HttpMethod.GET,    "/analytics/trends",                   compute.analyticsLambda);
    addRoute(apigwv2.HttpMethod.GET,    "/analytics/chartData",                compute.analyticsLambda);
    addRoute(apigwv2.HttpMethod.GET,    "/analytics/chart-data",               compute.analyticsLambda);
    addRoute(apigwv2.HttpMethod.GET,    "/health",                             compute.healthLambda);

    // Profile
    addRoute(apigwv2.HttpMethod.GET,    "/profile",                            compute.profileLambda);
    addRoute(apigwv2.HttpMethod.PATCH,  "/profile",                            compute.profileLambda);

    // Auth — unauthenticated routes
    const addPublicRoute = (routePath: string, integId: string) =>
      this.httpApi.addRoutes({
        path: routePath,
        methods: [apigwv2.HttpMethod.POST],
        integration: new apigwv2Integrations.HttpLambdaIntegration(integId, compute.authLambda),
      });

    addPublicRoute("/auth/register",         "AuthRegIntegration");
    addPublicRoute("/auth/confirm",          "AuthConfIntegration");
    addPublicRoute("/auth/login",            "AuthLogIntegration");
    addPublicRoute("/auth/refresh",          "AuthRefIntegration");
    addPublicRoute("/auth/forgot-password",  "AuthForgIntegration");
    addPublicRoute("/auth/confirm-password", "AuthCPwdIntegration");
    addPublicRoute("/auth/confirm-mfa",      "AuthMfaIntegration");

    // Auth — authenticated routes
    addRoute(apigwv2.HttpMethod.POST,   "/auth/logout",  compute.authLambda);
    this.httpApi.addRoutes({
      path:    "/auth/account",
      methods: [apigwv2.HttpMethod.DELETE],
      integration: new apigwv2Integrations.HttpLambdaIntegration("AuthDelAccountIntegration", compute.authLambda),
      authorizer,
    });

    // ── WebSocket API ──────────────────────────────────────────────────────────
    this.wsApi = new apigwv2.WebSocketApi(this, "WsApi", {
      apiName: `${prefix}-ws`,
      connectRouteOptions: {
        integration: new apigwv2Integrations.WebSocketLambdaIntegration("WsConnectIntegration", compute.wsHandlerLambda),
      },
      disconnectRouteOptions: {
        integration: new apigwv2Integrations.WebSocketLambdaIntegration("WsDisconnectIntegration", compute.wsHandlerLambda),
      },
    });

    this.wsStage = new apigwv2.WebSocketStage(this, "WsStage", {
      webSocketApi: this.wsApi,
      stageName:    "prod",
      autoDeploy:   true,
    });

    // If config provides a test override, use it; otherwise use the real stage callbackUrl.
    this.wsCallbackUrl = config.webSocketEndpoint || this.wsStage.callbackUrl;
  }
}
