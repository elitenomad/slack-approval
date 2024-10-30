import * as core from "@actions/core";
import { App, BlockAction, LogLevel } from "@slack/bolt";
import { WebClient } from "@slack/web-api";

const token = process.env.SLACK_BOT_TOKEN || "";
const signingSecret = process.env.SLACK_SIGNING_SECRET || "";
const slackAppToken = process.env.SLACK_APP_TOKEN || "";
const channel_id = process.env.SLACK_CHANNEL_ID || "";

const app = new App({
  token: token,
  signingSecret: signingSecret,
  appToken: slackAppToken,
  socketMode: true,
  port: 3000,
  logLevel: LogLevel.DEBUG,
});

async function run(): Promise<void> {
  try {
    const web = new WebClient(token);

    const github_server_url = process.env.GITHUB_SERVER_URL || "";
    const github_repos = process.env.GITHUB_REPOSITORY || "";
    const run_id = process.env.GITHUB_RUN_ID || "";
    const actionsUrl = `${github_server_url}/${github_repos}/actions/runs/${run_id}`;
    const workflow = process.env.GITHUB_WORKFLOW || "";
    const runnerOS = process.env.RUNNER_OS || "";
    const actor = process.env.GITHUB_ACTOR || "";

    const baseMessageTitle = "승인이 필요한 작업이 있습니다";
    const pendingMessageBody = "승인 대기중";
    const successMessageBody = "승인 완료";
    const failMessageBody = "승인 거절";
    const approvals = ["U07U2EYRBGD"];
    const minimumApprovalCount = 1;

    // 메인 메시지 전송
    const mainMessage = await web.chat.postMessage({
      channel: channel_id,
      text: baseMessageTitle,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: baseMessageTitle,
          },
        },
      ],
    });

    // 댓글 메시지 전송
    const replyMessage = await web.chat.postMessage({
      channel: channel_id,
      thread_ts: mainMessage.ts,
      text: pendingMessageBody,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: pendingMessageBody,
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*필요 승인자 수:* ${minimumApprovalCount}\n*남은 승인자:* <@${approvals.join(
              ", "
            )}>`,
          },
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: {
                type: "plain_text",
                emoji: true,
                text: "승인",
              },
              style: "primary",
              value: "approve",
              action_id: "slack-approval-approve",
            },
            {
              type: "button",
              text: {
                type: "plain_text",
                emoji: true,
                text: "거절",
              },
              style: "danger",
              value: "reject",
              action_id: "slack-approval-reject",
            },
          ],
        },
      ],
    });

    app.action(
      "slack-approval-approve",
      async ({ ack, client, body, logger }) => {
        await ack();
        try {
          const response_blocks = (<BlockAction>body).message?.blocks;
          response_blocks.pop();
          response_blocks.push({
            type: "section",
            text: {
              type: "mrkdwn",
              text: `Approved by <@${body.user.id}> `,
            },
          });

          const mainMessageBlocks = mainMessage.message?.blocks;
          mainMessageBlocks?.pop();
          mainMessageBlocks?.push({
            type: "section",
            text: {
              type: "mrkdwn",
              text: successMessageBody,
            },
          });
          logger.info("mainMessage.ts", mainMessage.ts);
          logger.info("replyMessage.ts", replyMessage.ts);

          await client.chat.update({
            ts: mainMessage.ts || "",
            token: body.token,
            channel: body.channel?.id || "",
            blocks: mainMessageBlocks ?? ([] as any),
          });
          await client.chat.update({
            channel: body.channel?.id || "",
            token: body.token,
            ts: replyMessage?.ts || "",
            blocks: response_blocks,
          });
        } catch (error) {
          logger.error(error);
        }

        process.exit(0);
      }
    );

    app.action(
      "slack-approval-reject",
      async ({ ack, client, body, logger }) => {
        await ack();
        try {
          const response_blocks = (<BlockAction>body).message?.blocks;
          response_blocks.pop();
          response_blocks.push({
            type: "section",
            text: {
              type: "mrkdwn",
              text: `Rejected by <@${body.user.id}>`,
            },
          });

          const mainMessageBlocks = mainMessage.message?.blocks;
          mainMessageBlocks?.pop();
          mainMessageBlocks?.push({
            type: "section",
            text: {
              type: "mrkdwn",
              text: failMessageBody,
            },
          });

          logger.info("mainMessage.ts", mainMessage.ts);
          logger.info("replyMessage.ts", replyMessage.ts);

          await client.chat.update({
            ts: mainMessage.ts || "",
            channel: body.channel?.id || "",
            token: body.token,
            blocks: mainMessageBlocks ?? ([] as any),
          });

          await client.chat.update({
            channel: body.channel?.id || "",
            ts: replyMessage?.ts || "",
            token: body.token,
            blocks: response_blocks,
          });
        } catch (error) {
          logger.error(error);
        }

        process.exit(1);
      }
    );

    (async () => {
      await app.start(3000);
      console.log("Waiting Approval reaction.....");
    })();
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message);
  }
}

run();
