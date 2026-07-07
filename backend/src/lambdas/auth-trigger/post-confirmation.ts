import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { createDynamoDBDocClient } from "../../utils/awsClients.js";
import { Logger } from "@aws-lambda-powertools/logger";
import type { PostConfirmationConfirmSignUpTriggerEvent } from "aws-lambda";

const ddb = createDynamoDBDocClient();
const TABLE = process.env.TABLE_NAME_MAIN!;

// Lazily instantiated to avoid constructor mocking issues in unit tests
const getLogger = () => new Logger({ serviceName: "auth-trigger" });

export const handler = async (event: PostConfirmationConfirmSignUpTriggerEvent) => {
  const logger = getLogger();
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
      // NOTE: Cognito does NOT retry this trigger. The user's status is already
      // set to CONFIRMED in the user pool before this Lambda runs, so throwing
      // here does not undo the confirmation — it only causes the originating
      // ConfirmSignUp/AdminConfirmSignUp API call to return an error to the
      // client. The net effect is a user left CONFIRMED in Cognito with no
      // profile record in DynamoDB. We still throw so the failure is surfaced
      // (metrics/alarms/logs) rather than silently swallowed; any reconciliation
      // for the orphaned-profile case must happen out-of-band (e.g. on first
      // login) rather than relying on a trigger retry that will never happen.
      throw error;
    }
  }

  return event;
};
