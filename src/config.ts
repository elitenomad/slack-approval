import * as core from "@actions/core";

export interface SlackConfig {
  botToken: string;
  signingSecret: string;
  appToken: string;
  channelId: string;
}

export interface ApprovalConfig {
  baseMessageTs: string;
  requiredApprovers: string[];
  minimumApprovalCount: number;
  baseMessagePayload: any;
  successMessagePayload: any;
  failMessagePayload: any;
}

export interface Config {
  slack: SlackConfig;
  approval: ApprovalConfig;
  uniqueStepId: string;
}

function parsePayloadInput(name: string): any {
  return JSON.parse(core.getMultilineInput(name).join(""));
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const requiredApprovers =
    core
      .getInput("approvers", { required: true, trimWhitespace: true })
      ?.split(",") ?? [];
  const minimumApprovalCount = Number(core.getInput("minimumApprovalCount")) || 1;

  if (minimumApprovalCount > requiredApprovers.length) {
    throw new Error("Insufficient approvers. Minimum required approvers not met.");
  }

  return {
    slack: {
      botToken: env.SLACK_BOT_TOKEN || "",
      signingSecret: env.SLACK_SIGNING_SECRET || "",
      appToken: env.SLACK_APP_TOKEN || "",
      channelId: env.SLACK_CHANNEL_ID || "",
    },
    approval: {
      baseMessageTs: core.getInput("baseMessageTs"),
      requiredApprovers,
      minimumApprovalCount,
      baseMessagePayload: parsePayloadInput("baseMessagePayload"),
      successMessagePayload: parsePayloadInput("successMessagePayload"),
      failMessagePayload: parsePayloadInput("failMessagePayload"),
    },
    uniqueStepId: env.UNIQUE_STEP_ID || "",
  };
}
