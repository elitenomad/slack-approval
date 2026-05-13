import type { Middleware, SlackActionMiddlewareArgs, BlockButtonAction } from "@slack/bolt";
import { ApprovalState } from "./state";
import { ApprovalConfig } from "./config";
import {
  ButtonConfig,
  hasPayload,
  renderQueuedBlock,
  renderRejectionBlock,
  replaceTrailingStatusBlocks,
} from "./blocks";

type ButtonHandler = Middleware<SlackActionMiddlewareArgs<BlockButtonAction>>;

export interface HandlerDeps {
  state: ApprovalState;
  mainMessage: { ts?: string };
  mainMessagePayload: { blocks: any[] } & Record<string, any>;
  buttons: ButtonConfig;
  approval: ApprovalConfig;
  exit: (code: number) => void;
}

interface UserContext {
  userId: string | undefined;
  userName: string;
  channelId: string | undefined;
}

function extractUserContext(body: BlockButtonAction): UserContext {
  return {
    userId: body.user?.id,
    userName:
      (body.user as any)?.name ||
      (body.user as any)?.username ||
      "Unknown User",
    channelId: body.channel?.id,
  };
}

function validateButtonClick(
  action: BlockButtonAction["actions"][number],
  expectedAid: string,
  logger: { warn: (msg: string) => void },
  kind: "approve" | "reject",
): boolean {
  if (action.type !== "button") {
    logger.warn(`Invalid ${kind === "reject" ? "reject " : ""}action type: ${action.type}`);
    return false;
  }
  if (action.value !== expectedAid) {
    logger.warn(
      `Invalid ${kind === "reject" ? "reject " : ""}action value: ${action.value}, expected: ${expectedAid}`,
    );
    return false;
  }
  return true;
}

async function setQueuedState(
  client: { chat: { update: (args: any) => Promise<any> } },
  channelId: string,
  ts: string,
  blocks: any[],
  userId: string,
  action: "approve" | "reject",
  logger: { warn: (msg: string) => void },
): Promise<void> {
  try {
    await client.chat.update({
      channel: channelId,
      ts,
      text: "",
      blocks: [...blocks.slice(0, -1), renderQueuedBlock(userId, action)],
    });
  } catch (queuedError) {
    logger.warn(`Failed to set queued state: ${queuedError}`);
  }
}

async function safePostEphemeral(
  client: { chat: { postEphemeral: (args: any) => Promise<any> } },
  channelId: string,
  userId: string,
  text: string,
  logger: { error: (msg: string) => void },
): Promise<void> {
  try {
    await client.chat.postEphemeral({ channel: channelId, user: userId, text });
  } catch (ephemeralError) {
    logger.error(`Failed to send ephemeral notification: ${ephemeralError}`);
  }
}

export function createApproveHandler(deps: HandlerDeps): ButtonHandler {
  const { state, mainMessage, mainMessagePayload, buttons, approval, exit } = deps;

  return async ({ ack, client, body, logger, action }) => {
    try {
      await ack();

      if (!validateButtonClick(action, buttons.aid, logger, "approve")) return;

      const { userId, userName, channelId } = extractUserContext(body);
      logger.info(`Approval request from user: ${userName} (${userId}) in channel: ${channelId}`);

      if (!userId) {
        logger.error("No user ID found in request body");
        return;
      }

      if (state.hasApproved(userId)) {
        logger.info(`User ${userName} (${userId}) has already approved`);
        await safePostEphemeral(client, channelId || "", userId, "You have already approved this request.", logger);
        return;
      }

      if (!state.isRequired(userId)) {
        logger.warn(`Unauthorized approval attempt by user: ${userName} (${userId})`);
        await safePostEphemeral(client, channelId || "", userId, "You are not authorized to approve this request.", logger);
        return;
      }

      await setQueuedState(
        client,
        channelId || "",
        mainMessage.ts || "",
        mainMessagePayload.blocks,
        userId,
        "approve",
        logger,
      );

      const approveResult = state.approve(userId);
      logger.info(`Approval result for ${userName}: ${approveResult}`);

      try {
        if (approveResult === "approved") {
          logger.info(`Request fully approved by ${userName}. Exiting with success.`);
          await client.chat.update({
            ts: mainMessage.ts || "",
            channel: channelId || "",
            ...(hasPayload(approval.successMessagePayload)
              ? approval.successMessagePayload
              : mainMessagePayload),
          });
        } else if (approveResult === "remainApproval") {
          logger.info(`Partial approval by ${userName}. ${state.remainingApprovalCount} more approvals needed.`);
          await client.chat.update({
            channel: channelId || "",
            ts: mainMessage?.ts || "",
            text: "",
            blocks: replaceTrailingStatusBlocks(mainMessagePayload.blocks, state, buttons),
          });
        } else {
          logger.warn(`Unexpected approval result: ${approveResult}`);
        }
      } catch (updateError) {
        logger.error(`Failed to update message: ${updateError}`);
        await safePostEphemeral(client, channelId || "", userId, "❌ Failed to update the approval message. Please try again.", logger);
      }

      if (approveResult === "approved") {
        exit(0);
      }
    } catch (error) {
      logger.error(`Error in approval action handler: ${error}`);
      const userId = body.user?.id;
      const channelId = body.channel?.id;
      if (userId && channelId) {
        await safePostEphemeral(client, channelId, userId, "❌ An error occurred while processing your approval. Please try again.", logger);
      }
    }
  };
}

export function createRejectHandler(deps: HandlerDeps): ButtonHandler {
  const { state, mainMessage, mainMessagePayload, buttons, approval, exit } = deps;

  return async ({ ack, client, body, logger, action }) => {
    try {
      await ack();

      if (!validateButtonClick(action, buttons.aid, logger, "reject")) return;

      const { userId, userName, channelId } = extractUserContext(body);
      logger.info(`Rejection request from user: ${userName} (${userId}) in channel: ${channelId}`);

      if (!userId) {
        logger.error("No user ID found in reject request body");
        return;
      }

      if (!state.canReject(userId)) {
        logger.warn(`Unauthorized rejection attempt by user: ${userName} (${userId})`);
        await safePostEphemeral(client, channelId || "", userId, "You are not authorized to reject this request.", logger);
        return;
      }

      if (state.isFullyApproved) {
        logger.info(`Rejection attempt by ${userName} after request was already approved`);
        await safePostEphemeral(client, channelId || "", userId, "This request has already been approved and cannot be rejected.", logger);
        return;
      }

      logger.info(`Request rejected by ${userName}. Exiting with failure.`);

      await setQueuedState(
        client,
        channelId || "",
        mainMessage.ts || "",
        mainMessagePayload.blocks,
        userId,
        "reject",
        logger,
      );

      try {
        await client.chat.update({
          ts: mainMessage.ts || "",
          channel: channelId || "",
          ...(hasPayload(approval.failMessagePayload)
            ? approval.failMessagePayload
            : {
                text: `❌ Request rejected by <@${userId}>`,
                blocks: [...mainMessagePayload.blocks.slice(0, -2), renderRejectionBlock(userId)],
              }),
        });
      } catch (updateError) {
        logger.error(`Failed to update message with rejection: ${updateError}`);
        await safePostEphemeral(client, channelId || "", userId, "❌ Failed to update the rejection message. The request will still be rejected.", logger);
      }

      exit(1);
    } catch (error) {
      logger.error(`Error in rejection action handler: ${error}`);
      const userId = body.user?.id;
      const channelId = body.channel?.id;
      if (userId && channelId) {
        await safePostEphemeral(client, channelId, userId, "❌ An error occurred while processing your rejection. Please try again.", logger);
      }
      exit(1);
    }
  };
}
