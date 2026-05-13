import { ApprovalState } from "./state";

export interface ButtonConfig {
  aid: string;
  uniqueStepId: string;
}

export interface GithubRunContext {
  actor: string;
  serverUrl: string;
  repository: string;
  runId: string;
  workflow: string;
  runnerOs: string;
  actionsUrl: string;
}

export function readGithubRunContext(env: NodeJS.ProcessEnv = process.env): GithubRunContext {
  const serverUrl = env.GITHUB_SERVER_URL || "";
  const repository = env.GITHUB_REPOSITORY || "";
  const runId = env.GITHUB_RUN_ID || "";
  return {
    actor: env.GITHUB_ACTOR || "",
    serverUrl,
    repository,
    runId,
    workflow: env.GITHUB_WORKFLOW || "",
    runnerOs: env.RUNNER_OS || "",
    actionsUrl: `${serverUrl}/${repository}/actions/runs/${runId}`,
  };
}

export function buildActionId(ctx: GithubRunContext, env: NodeJS.ProcessEnv = process.env): string {
  return `${ctx.repository}-${ctx.workflow}-${ctx.runId}-${env.GITHUB_RUN_NUMBER || ""}-${env.GITHUB_RUN_ATTEMPT || ""}`;
}

export function hasPayload(inputs: { text?: string; blocks?: unknown[] } | null | undefined): boolean {
  if (!inputs) return false;
  return (inputs.text?.length ?? 0) > 0 || (inputs.blocks?.length ?? 0) > 0;
}

export function renderApprovalStatus(state: ApprovalState) {
  return {
    type: "section",
    text: {
      type: "mrkdwn",
      text: `*Required Approvers Count:* ${state.minimumApprovalCount}\n*Remaining Approvers:* ${state.remainingApprovers
        .map((v) => `<@${v}>`)
        .join(", ")}\n${
        state.approvers.length > 0
          ? `Approvers: ${state.approvers.map((v) => `<@${v}>`).join(", ")} `
          : ""
      }\n`,
    },
  };
}

export function renderApprovalButtons(state: ApprovalState, buttons: ButtonConfig) {
  if (!state.isFullyApproved) {
    return {
      type: "actions",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            emoji: true,
            text: `✅ Approve (${state.remainingApprovalCount} needed)`,
          },
          style: "primary",
          value: buttons.aid,
          action_id: `slack-approval-approve-${buttons.uniqueStepId}`,
        },
        {
          type: "button",
          text: {
            type: "plain_text",
            emoji: true,
            text: "❌ Reject",
          },
          style: "danger",
          value: buttons.aid,
          action_id: `slack-approval-reject-${buttons.uniqueStepId}`,
        },
      ],
    };
  }

  return {
    type: "section",
    text: {
      type: "mrkdwn",
      text: `🎉 *Approval Complete!* All ${state.minimumApprovalCount} required approvals have been received.`,
    },
  };
}

export function renderDefaultRequestBlocks(ctx: GithubRunContext, state: ApprovalState, buttons: ButtonConfig) {
  return [
    {
      type: "section",
      text: { type: "mrkdwn", text: "GitHub Actions Approval Request" },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*GitHub Actor:*\n${ctx.actor}` },
        { type: "mrkdwn", text: `*Repos:*\n${ctx.serverUrl}/${ctx.repository}` },
        { type: "mrkdwn", text: `*Actions URL:*\n${ctx.actionsUrl}` },
        { type: "mrkdwn", text: `*GITHUB_RUN_ID:*\n${ctx.runId}` },
        { type: "mrkdwn", text: `*Workflow:*\n${ctx.workflow}` },
        { type: "mrkdwn", text: `*RunnerOS:*\n${ctx.runnerOs}` },
      ],
    },
    renderApprovalStatus(state),
    renderApprovalButtons(state, buttons),
  ];
}

export function composeMainMessage(
  baseMessagePayload: any,
  ctx: GithubRunContext,
  state: ApprovalState,
  buttons: ButtonConfig,
  uniqueStepId: string,
): { text?: string; blocks: any[] } {
  if (hasPayload(baseMessagePayload)) {
    return {
      ...baseMessagePayload,
      text: baseMessagePayload.text || `GitHub Actions Approval Request #${uniqueStepId}`,
      blocks: [
        ...(baseMessagePayload.blocks ?? []),
        renderApprovalStatus(state),
        renderApprovalButtons(state, buttons),
      ],
    };
  }

  return { blocks: renderDefaultRequestBlocks(ctx, state, buttons) };
}

export function replaceTrailingStatusBlocks(
  blocks: readonly any[],
  state: ApprovalState,
  buttons: ButtonConfig,
): any[] {
  return [...blocks.slice(0, -2), renderApprovalStatus(state), renderApprovalButtons(state, buttons)];
}

export function renderQueuedBlock(userId: string, action: "approve" | "reject") {
  const label = action === "approve" ? "approval" : "rejection";
  return {
    type: "section",
    text: {
      type: "mrkdwn",
      text: `⏳ *Queued ${label}* from <@${userId}>...`,
    },
  };
}

export function renderRejectionBlock(userId: string) {
  return {
    type: "section",
    text: {
      type: "mrkdwn",
      text: `❌ *Request Rejected*\nRejected by <@${userId}> on ${new Date().toLocaleString()}`,
    },
  };
}
