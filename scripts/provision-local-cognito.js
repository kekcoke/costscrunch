import { 
  CognitoIdentityProviderClient, 
  CreateUserPoolCommand, 
  CreateUserPoolClientCommand 
} from "@aws-sdk/client-cognito-identity-provider";
import fs from "fs";

const client = new CognitoIdentityProviderClient({
  endpoint: "http://localhost:9229",
  region: "us-east-1",
  credentials: { accessKeyId: "test", secretAccessKey: "test" }
});

async function run() {
  try {
    const pool = await client.send(new CreateUserPoolCommand({ PoolName: "LocalPool" }));
    fs.writeFileSync(".cognito_pool_info.json", JSON.stringify(pool));
    console.log("Pool created:", pool.UserPool.Id);

    const poolClient = await client.send(new CreateUserPoolClientCommand({
      UserPoolId: pool.UserPool.Id,
      ClientName: "LocalClient",
      ExplicitAuthFlows: ["ALLOW_USER_PASSWORD_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]
    }));
    fs.writeFileSync(".cognito_client_info.json", JSON.stringify(poolClient));
    console.log("Client created:", poolClient.UserPoolClient.ClientId);
  } catch (e) {
    console.error("Provisioning failed:", e);
    process.exit(1);
  }
}

run();
