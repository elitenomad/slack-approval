import * as core from "@actions/core";
import { App, LogLevel } from "@slack/bolt";
import { WebClient } from "@slack/web-api";
import { ApprovalState } from "./state";
import {
  buildActionId,
  composeMainMessage,
  hasPayload,
  readGithubRunContext,
} from "./blocks";
import { loadConfig } from "./config";
import { createApproveHandler, createRejectHandler } from "./handlers";

async function run(): Promise<void> {
  try {
    const config = loadConfig();
    const { slack, approval, uniqueStepId } = config;
    console.log("unique_step_id", uniqueStepId);

    const state = new ApprovalState({
      requiredApprovers: approval.requiredApprovers,
      minimumApprovalCount: approval.minimumApprovalCount,
    });

    const app = new App({
      token: slack.botToken,
      signingSecret: slack.signingSecret,
      appToken: slack.appToken,
      socketMode: true,
      port: 3000,
      logLevel: LogLevel.DEBUG,
    });

    const web = new WebClient(slack.botToken);

    const ghContext = readGithubRunContext();
    const aid = buildActionId(ghContext);
    const buttons = { aid, uniqueStepId };

    const mainMessagePayload = composeMainMessage(
      approval.baseMessagePayload,
      ghContext,
      state,
      buttons,
      uniqueStepId,
    );

    const mainMessage = approval.baseMessageTs
      ? await web.chat.update({
          channel: slack.channelId,
          ts: approval.baseMessageTs,
          ...mainMessagePayload,
        })
      : await web.chat.postMessage({
          channel: slack.channelId,
          ...mainMessagePayload,
        });

    core.setOutput("mainMessageTs", mainMessage.ts);

    let resolveExit!: (code: number) => void;
    const exitCode = new Promise<number>((resolve) => {
      resolveExit = resolve;
    });
    let signalled = false;
    const signalExit = (code: number) => {
      if (signalled) return;
      signalled = true;
      resolveExit(code);
    };

    const cancelHandler = async () => {
      try {
        await web.chat.update({
          ts: mainMessage.ts!,
          channel: slack.channelId,
          ...(hasPayload(approval.failMessagePayload)
            ? approval.failMessagePayload
            : mainMessagePayload),
        });
      } catch (err) {
        core.warning(`Failed to update Slack message on cancel: ${err}`);
      }
      signalExit(1);
    };

    process.on("SIGTERM", cancelHandler);
    process.on("SIGINT", cancelHandler);
    process.on("SIGBREAK", cancelHandler);

    const handlerDeps = {
      state,
      mainMessage,
      mainMessagePayload,
      buttons,
      approval,
      exit: signalExit,
    };
    app.action(`slack-approval-approve-${uniqueStepId}`, createApproveHandler(handlerDeps));
    app.action(`slack-approval-reject-${uniqueStepId}`, createRejectHandler(handlerDeps));

    // Catch-all: when multiple parallel jobs share one Slack app token, every job opens its
    // own Socket Mode connection and Slack load-balances clicks across them. A click can land
    // on a process whose handler isn't registered for that action_id; without an ack, Slack
    // shows the yellow ⚠️ triangle after 3s. This catch-all acks any slack-approval-* action
    // so foreign sockets stop timing out. The owning process's specific handler still runs in
    // parallel and performs the real state mutation + message updates.
    app.action(/^slack-approval-(approve|reject)-/, async ({ ack, action, logger }) => {
      await ack();
      const aid = (action as { action_id?: string }).action_id;
      if (typeof aid === "string" && !aid.endsWith(`-${uniqueStepId}`)) {
        logger.info(
          `Foreign action ${aid} received on step "${uniqueStepId}" socket; acked but ignored (owner socket will handle it if Slack routed there).`,
        );
      }
    });

    await app.start(3000);
    console.log("Waiting Approval reaction.....");

    const code = await exitCode;

    try {
      await app.stop();
    } catch (err) {
      core.warning(`Failed to stop Slack app cleanly: ${err}`);
    }

    process.exit(code);
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message);
  }
}

run();
