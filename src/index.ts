import * as core from "@actions/core";
import { App, BlockAction, LogLevel } from "@slack/bolt";
import { WebClient } from "@slack/web-api";

const token = process.env.SLACK_BOT_TOKEN || "";
const signingSecret = process.env.SLACK_SIGNING_SECRET || "";
const slackAppToken = process.env.SLACK_APP_TOKEN || "";
const channel_id = process.env.SLACK_CHANNEL_ID || "";
const unique_step_id = process.env.UNIQUE_STEP_ID || "";
console.log("unique_step_id", unique_step_id);
const baseMessageTs = core.getInput("baseMessageTs");
const requiredApprovers = core
  .getInput("approvers", { required: true, trimWhitespace: true })
  ?.split(",");
const minimumApprovalCount = Number(core.getInput("minimumApprovalCount")) || 1;
const baseMessagePayload = JSON.parse(
  core.getMultilineInput("baseMessagePayload").join("")
);
const approvers: string[] = [];

const successMessagePayload = JSON.parse(
  core.getMultilineInput("successMessagePayload").join("")
);
const failMessagePayload = JSON.parse(
  core.getMultilineInput("failMessagePayload").join("")
);

const app = new App({
  token: token,
  signingSecret: signingSecret,
  appToken: slackAppToken,
  socketMode: true,
  port: 3000,
  logLevel: LogLevel.DEBUG,
});

if (minimumApprovalCount > requiredApprovers.length) {
  console.error(
    "Error: Insufficient approvers. Minimum required approvers not met."
  );
  process.exit(1);
}
function hasPayload(inputs: any) {
  return inputs.text?.length > 0 || inputs.blocks?.length > 0;
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

    const renderApprovalStatus = () => {
      return {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Required Approvers Count:* ${minimumApprovalCount}\n*Remaining Approvers:* ${requiredApprovers
            .map((v) => `<@${v}>`)
            .join(", ")}\n${
            approvers.length > 0
              ? `Approvers: ${approvers.map((v) => `<@${v}>`).join(", ")} `
              : ""
          }\n`,
        },
      };
    };

    const renderApprovalButtons = () => {
      if (minimumApprovalCount >= approvers.length) {
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
              action_id: `slack-approval-approve-${unique_step_id}`,
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
              action_id: `slack-approval-reject-${unique_step_id}`,
            },
          ],
        };
      }
      return {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `Approved :white_check_mark:`,
        },
      };
    };

    const mainMessagePayload = hasPayload(baseMessagePayload)
      ? baseMessagePayload
      : {
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: "GitHub Actions Approval Request",
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
            renderApprovalStatus(),
            renderApprovalButtons(),
          ],
        };

    function approve(userId: string) {
      const idx = requiredApprovers.findIndex((user) => user === userId);
      if (idx === -1) {
        return "notApproval";
      }
      requiredApprovers.splice(idx, 1);
      approvers.push(userId);

      if (approvers.length < minimumApprovalCount) {
        return "remainApproval";
      }

      return "approved";
    }

    const mainMessage = baseMessageTs
      ? await web.chat.update({
          channel: channel_id,
          ts: baseMessageTs,
          ...mainMessagePayload,
        })
      : await web.chat.postMessage({
          channel: channel_id,
          ...mainMessagePayload,
        });

    core.setOutput("mainMessageTs", mainMessage.ts);

    async function cancelHandler() {
      await web.chat.update({
        ts: mainMessage.ts!,
        channel: channel_id,
        ...(hasPayload(failMessagePayload)
          ? failMessagePayload
          : mainMessagePayload),
      });
      process.exit(1);
    }

    process.on("SIGTERM", cancelHandler);
    process.on("SIGINT", cancelHandler);
    process.on("SIGBREAK", cancelHandler);

    app.action(
      `slack-approval-approve-${unique_step_id}`,
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
              ...(hasPayload(successMessagePayload)
                ? successMessagePayload
                : mainMessagePayload),
            });
          } else {
            await client.chat.update({
              channel: body.channel?.id || "",
              ts: mainMessage?.ts || "",
              text: "",
              blocks: [
                ...mainMessagePayload.blocks.slice(0, -2),
                renderApprovalStatus(),
                renderApprovalButtons(),
              ],
            });
          }
        } catch (error) {
          logger.error(error);
        }

        if (approveResult === "approved") {
          process.exit(0);
        }
      }
    );

    app.action(
      `slack-approval-reject-${unique_step_id}`,
      async ({ ack, client, body, logger, action }) => {
        await ack();
        if (action.type !== "button") {
          return;
        }
        if (action.value !== aid) {
          return;
        }
        
        try {
          // await client.chat.update({
          //   ts: mainMessage.ts || "",
          //   channel: body.channel?.id || "",
          //   ...(hasPayload(failMessagePayload)
          //     ? failMessagePayload
          //     : mainMessagePayload),
          // });

          await client.chat.update({
            channel: body.channel?.id || "",
            ts: mainMessage?.ts || "",
            text: "",
            blocks: [
              ...mainMessagePayload.blocks.slice(0, -2),
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `Rejected by <@${body.user.id}> :x:`,
                },
              },
            ],
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
