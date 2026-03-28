import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { createDynamoDBDocClient } from "../../utils/awsClients.js";
import { Logger } from "@aws-lambda-powertools/logger";
import type { PostConfirmationConfirmSignUpTriggerEvent } from "aws-lambda";

const ddb = createDynamoDBDocClient();
const TABLE = process.env.TABLE_NAME_MAIN!;
const logger = new Logger({ serviceName: "auth-trigger" });

export const handler = async (event: PostConfirmationConfirmSignUpTriggerEvent) => {
  logger.info("Post-confirmation trigger invoked", { event });

  const { sub, email, name } = event.request.userAttributes;
  const now = new Date().toISOString();

  // Create the base user profile record in our Single-Table design
  const profile = {
    pk: `USER#${sub}`,
    sk: `PROFILE#${sub}`,
    gsi1pk: `EMAIL#${email}`,
    gsi1sk: `USER#${sub}`,
    entityType: "USER",
    userId: sub,
    email,
    name: name || email.split("@")[0],
    currency: "USD",
    timezone: "UTC",
    locale: "en-US",
    plan: "free",
    notificationPreferences: {
      email: true,
      push: true,
      sms: false,
      digestFrequency: "weekly"
    },
    createdAt: now,
    updatedAt: now,
    lastActiveAt: now,
  };

  try {
    await ddb.send(new PutCommand({
      TableName: TABLE,
      Item: profile,
      // Ensure we don't overwrite if trigger fires multiple times
      ConditionExpression: "attribute_not_exists(pk)",
    }));
    logger.info("User profile created successfully", { userId: sub });
  } catch (error: any) {
    if (error.name === "ConditionalCheckFailedException") {
      logger.info("User profile already exists, skipping creation", { userId: sub });
    } else {
      logger.error("Failed to create user profile", { error, userId: sub });
      throw error; // Let Cognito retry
    }
  }

  return event;
};
