import {
  CognitoIdentityProviderClient,
  CreateUserPoolCommand,
  CreateUserPoolClientCommand,
  AdminCreateUserCommand,
  AdminAddUserToGroupCommand,
  DescribeUserPoolCommand,
  DescribeUserPoolClientCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import fs from "fs";
import path from "path";

const COGNITO_ENDPOINT = process.env.COGNITO_ENDPOINT || "http://localhost:9229";
const POOL_NAME = "LocalPool";
const CLIENT_NAME = "LocalClient";
const TEST_USERS = [
  { email: "test@costscrunch.dev", name: "Test User", password: "Test@1234", group: "pro" },
  { email: "jane@costscrunch.dev", name: "Jane Doe", password: "Test@1234", group: "member" },
  { email: "bob@costscrunch.dev", name: "Bob Smith", password: "Test@1234", group: "member" },
];

const client = new CognitoIdentityProviderClient({
  endpoint: COGNITO_ENDPOINT,
  region: "us-east-1",
  credentials: { accessKeyId: "test", secretAccessKey: "test" }
});

async function waitForCognito(maxAttempts = 30) {
  console.log("⏳ Waiting for Cognito Local to be ready...");
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await client.send(new DescribeUserPoolCommand({ UserPoolId: "dummy" }));
    } catch (e) {
      if (e.name === "ResourceNotFoundException") {
        return true;
      }
      if (e.name === "UnknownEndpointError" || e.code === "ECONNREFUSED") {
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
    }
  }
  throw new Error("Cognito Local did not become ready in time");
}

async function run() {
  try {
    await waitForCognito();

    // Check if pool already exists
    let poolId;
    let clientId;
    try {
      const existingPool = await client.send(new DescribeUserPoolCommand({ UserPoolId: POOL_NAME }));
      poolId = existingPool.UserPool?.Id;
      console.log("↳ Using existing pool:", poolId);
    } catch {
      // Pool doesn't exist, create it
      const pool = await client.send(new CreateUserPoolCommand({
        PoolName: POOL_NAME,
        AdminCreateUserSettings: {
          AllowAdminCreateUserOnly: false,
        },
        AutoVerifiedAttributes: ["email"],
      }));
      poolId = pool.UserPool?.Id;
      fs.writeFileSync(".cognito_pool_info.json", JSON.stringify(pool));
      console.log("✅ Pool created:", poolId);
    }

    // Check if client already exists
    try {
      const existingClient = await client.send(new DescribeUserPoolClientCommand({
        UserPoolId: poolId,
        ClientId: CLIENT_NAME,
      }));
      clientId = existingClient.UserPoolClient?.ClientId;
      console.log("↳ Using existing client:", clientId);
    } catch {
      // Client doesn't exist, create it
      const poolClient = await client.send(new CreateUserPoolClientCommand({
        UserPoolId: poolId,
        ClientName: CLIENT_NAME,
        ExplicitAuthFlows: [
          "ALLOW_USER_PASSWORD_AUTH",
          "ALLOW_REFRESH_TOKEN_AUTH",
          "ALLOW_USER_SRP_AUTH",
        ],
        GenerateSecret: false,
        SupportedIdentityProviders: ["COGNITO_USER_POOLS"],
        CallbackURLs: ["http://localhost:3000/callback", "http://localhost:3001/callback"],
        LogoutURLs: ["http://localhost:3000/logout", "http://localhost:3001/logout"],
      }));
      clientId = poolClient.UserPoolClient?.ClientId;
      fs.writeFileSync(".cognito_client_info.json", JSON.stringify(poolClient));
      console.log("✅ Client created:", clientId);
    }

    // Create test users
    for (const user of TEST_USERS) {
      try {
        await client.send(new AdminCreateUserCommand({
          UserPoolId: poolId,
          Username: user.email,
          UserAttributes: [
            { Name: "email", Value: user.email },
            { Name: "email_verified", Value: "true" },
            { Name: "name", Value: user.name },
          ],
          MessageAction: "SUPPRESS",
          TemporaryPassword: user.password,
        }));

        await client.send(new AdminAddUserToGroupCommand({
          UserPoolId: poolId,
          Username: user.email,
          GroupName: user.group,
        }));
        console.log(`✅ User created: ${user.email} (group: ${user.group})`);
      } catch (e) {
        if (e.name === "UsernameExistsException") {
          console.log(`↳ User already exists: ${user.email}`);
        } else {
          console.error(`⚠️ Failed to create user ${user.email}:`, e.message);
        }
      }
    }

    console.log("\n✅ Cognito provisioning complete!");
    console.log("   Pool ID:", poolId);
    console.log("   Client ID:", clientId);
    console.log("\nTest credentials:");
    for (const user of TEST_USERS) {
      console.log(`   ${user.email} / ${user.password}`);
    }
  } catch (e) {
    console.error("❌ Provisioning failed:", e);
    process.exit(1);
  }
}

run();
