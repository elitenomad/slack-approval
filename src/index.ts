import * as core from "@actions/core";
import { App, BlockAction, LogLevel } from "@slack/bolt";
import { WebClient } from "@slack/web-api";

const token = process.env.SLACK_BOT_TOKEN || "";
const signingSecret = process.env.SLACK_SIGNING_SECRET || "";
const slackAppToken = process.env.SLACK_APP_TOKEN || "";
const channel_id = process.env.SLACK_CHANNEL_ID || "";
const baseMessageTs = core.getInput("baseMessageTs");
const approvers = core
  .getInput("approvers", { required: true, trimWhitespace: true })
  ?.split(",");
const minimumApprovalCount = Number(core.getInput("minimumApprovalCount")) || 1;
const baseMessageBlocks = JSON.parse(
  core.getMultilineInput("baseMessageBlocks").join("")
);

const successMessageBlocks = JSON.parse(
  core.getMultilineInput("successMessageBlocks").join("")
);
const failMessageBlocks = JSON.parse(
  core.getMultilineInput("failMessageBlocks").join("")
);

const app = new App({
  token: token,
  signingSecret: signingSecret,
  appToken: slackAppToken,
  socketMode: true,
  port: 3000,
  logLevel: LogLevel.DEBUG,
});

if (minimumApprovalCount > approvers.length) {
  console.error(
    "Error: Insufficient approvers. Minimum required approvers not met."
  );
  process.exit(1);
}
function hasBlocks(inputs: any) {
  return inputs.length > 0;
}

async function run(): Promise<void> {
  try {
    const web = new WebClient(token);

    const github_server_url = process.env.GITHUB_SERVER_URL || "";
    const github_repos = process.env.GITHUB_REPOSITORY || "";
    const run_id = process.env.GITHUB_RUN_ID || "";
    const run_number = process.env.GITHUB_RUN_NUMBER || "";
    const run_attempt = process.env.GITHUB_RUN_ATTEMPT || "";
    const workflow = process.env.GITHUB_WORKFLOW || "";
    const aid = `${github_repos}-${workflow}-${run_id}-${run_number}-${run_attempt}`;
    const runnerOS = process.env.RUNNER_OS || "";
    const actor = process.env.GITHUB_ACTOR || "";
    const actionsUrl = `${github_server_url}/${github_repos}/actions/runs/${run_id}`;
    const defaultMainMessageBlocks = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `GitHub Actions Approval Request`,
        },
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*GitHub Actor:*\n${actor}`,
          },
          {
            type: "mrkdwn",
            text: `*Repos:*\n${github_server_url}/${github_repos}`,
          },
          {
            type: "mrkdwn",
            text: `*Actions URL:*\n${actionsUrl}`,
          },
          {
            type: "mrkdwn",
            text: `*GITHUB_RUN_ID:*\n${run_id}`,
          },
          {
            type: "mrkdwn",
            text: `*Workflow:*\n${workflow}`,
          },
          {
            type: "mrkdwn",
            text: `*RunnerOS:*\n${runnerOS}`,
          },
        ],
      },
    ];

    const renderReplyTitle = () => {
      return {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Required Approvers Count:* ${minimumApprovalCount}\n*Remaining Approvers:* ${approvers
            .map((v) => `<@${v}>`)
            .join(", ")}`,
        },
      };
    };

    const renderReplyBody = () => {
      if (approvers.length > 0) {
        return {
          type: "actions",
          elements: [
            {
              type: "button",
              text: {
                type: "plain_text",
                emoji: true,
                text: "approve",
              },
              style: "primary",
              value: aid,
              action_id: "slack-approval-approve",
            },
            {
              type: "button",
              text: {
                type: "plain_text",
                emoji: true,
                text: "reject",
              },
              style: "danger",
              value: aid,
              action_id: "slack-approval-reject",
            },
          ],
        };
      }
      return {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `Approved ✅`,
        },
      };
    };

    function approve(userId: string) {
      const idx = approvers.findIndex((user) => user === userId);
      if (idx === -1) {
        return "notApproval";
      }
      approvers.splice(idx, 1);

      if (approvers.length > 0) {
        return "remainApproval";
      }

      return "approved";
    }

    const mainMessage = baseMessageTs
      ? await web.chat.update({
          channel: channel_id,
          ts: baseMessageTs,
          blocks: hasBlocks(baseMessageBlocks)
            ? baseMessageBlocks
            : defaultMainMessageBlocks,
        })
      : await web.chat.postMessage({
          channel: channel_id,
          blocks: hasBlocks(baseMessageBlocks)
            ? baseMessageBlocks
            : defaultMainMessageBlocks,
        });

    const replyMessage = await web.chat.postMessage({
      channel: channel_id,
      thread_ts: mainMessage.ts,
      text: "",
      blocks: [renderReplyTitle(), renderReplyBody()],
    });

    core.exportVariable("mainMessageTs", mainMessage.ts);
    core.exportVariable("replyMessageTs", replyMessage.ts);

    app.action(
      "slack-approval-approve",
      async ({ ack, client, body, logger, action }) => {
        await ack();
        if (action.type !== "button") {
          return;
        }
        if (action.value !== aid) {
          return;
        }
        const approveResult = approve(body.user.id);

        try {
          if (approveResult === "approved") {
            await client.chat.update({
              ts: mainMessage.ts || "",
              channel: body.channel?.id || "",
              blocks: [
                {
                  type: "section",
                  text: {
                    type: "mrkdwn",
                    text: hasBlocks(successMessageBlocks)
                      ? successMessageBlocks
                      : defaultMainMessageBlocks,
                  },
                },
              ],
            });
          }
          await client.chat.update({
            channel: body.channel?.id || "",
            ts: replyMessage?.ts || "",
            blocks: [renderReplyTitle(), renderReplyBody()],
          });
        } catch (error) {
          logger.error(error);
        }

        if (approveResult === "approved") {
          process.exit(0);
        }
      }
    );

    app.action(
      "slack-approval-reject",
      async ({ ack, client, body, logger, action }) => {
        await ack();
        if (action.type !== "button") {
          return;
        }
        if (action.value !== aid) {
          return;
        }
        try {
          const response_blocks = (<BlockAction>body).message?.blocks;
          response_blocks.pop();
          response_blocks.push({
            type: "section",
            text: {
              type: "mrkdwn",
              text: `Rejected by <@${body.user.id}> ❌`,
            },
          });

          await client.chat.update({
            ts: mainMessage.ts || "",
            channel: body.channel?.id || "",
            blocks: hasBlocks(failMessageBlocks)
              ? failMessageBlocks
              : defaultMainMessageBlocks,
          });

          await client.chat.update({
            channel: body.channel?.id || "",
            ts: replyMessage?.ts || "",
            blocks: response_blocks,
          });
        } catch (error) {
          logger.error(error);
        }

        process.exit(1);
      }
    );
    process.on("SIGTERM", () => {
      web.chat.update({
        ts: mainMessage.ts!,
        blocks: failMessageBlocks,
        channel: channel_id,
        attachments: [],
      });
      web.chat.update({
        ts: replyMessage.ts!,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `Canceled 🔘 ↩️`,
            },
          },
        ],
        channel: channel_id,
      });
    });
    (async () => {
      await app.start(3000);
      console.log("Waiting Approval reaction.....");
    })();
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message);
  }
}

run();
