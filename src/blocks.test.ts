import { describe, it, expect } from "vitest";
import { ApprovalState } from "./state";
import {
  readGithubRunContext,
  buildActionId,
  hasPayload,
  renderApprovalStatus,
  renderApprovalButtons,
  renderDefaultRequestBlocks,
  composeMainMessage,
  replaceTrailingStatusBlocks,
  renderRejectionBlock,
  GithubRunContext,
  ButtonConfig,
} from "./blocks";

function makeState(opts?: { approved?: string[]; required?: string[]; minimum?: number }) {
  const state = new ApprovalState({
    requiredApprovers: opts?.required ?? ["U1", "U2"],
    minimumApprovalCount: opts?.minimum ?? 2,
  });
  for (const u of opts?.approved ?? []) state.approve(u);
  return state;
}

const buttons: ButtonConfig = { aid: "repo-wf-1-1-1", uniqueStepId: "step" };

const ctx: GithubRunContext = {
  actor: "alice",
  serverUrl: "https://github.com",
  repository: "acme/repo",
  runId: "42",
  workflow: "deploy",
  runnerOs: "Linux",
  actionsUrl: "https://github.com/acme/repo/actions/runs/42",
};

describe("readGithubRunContext", () => {
  it("composes actionsUrl from server/repo/runId and falls back to empty strings", () => {
    const result = readGithubRunContext({
      GITHUB_SERVER_URL: "https://gh.example",
      GITHUB_REPOSITORY: "org/proj",
      GITHUB_RUN_ID: "7",
      GITHUB_ACTOR: "bob",
      GITHUB_WORKFLOW: "ci",
      RUNNER_OS: "macOS",
    });

    expect(result).toEqual({
      actor: "bob",
      serverUrl: "https://gh.example",
      repository: "org/proj",
      runId: "7",
      workflow: "ci",
      runnerOs: "macOS",
      actionsUrl: "https://gh.example/org/proj/actions/runs/7",
    });
  });

  it("defaults missing env vars to empty strings", () => {
    const result = readGithubRunContext({});
    expect(result.actor).toBe("");
    expect(result.actionsUrl).toBe("//actions/runs/");
  });
});

describe("buildActionId", () => {
  it("concatenates repository, workflow, runId, run number and attempt", () => {
    const id = buildActionId(ctx, { GITHUB_RUN_NUMBER: "3", GITHUB_RUN_ATTEMPT: "2" });
    expect(id).toBe("acme/repo-deploy-42-3-2");
  });

  it("leaves trailing dashes when run-number/attempt are missing", () => {
    const id = buildActionId(ctx, {});
    expect(id).toBe("acme/repo-deploy-42--");
  });
});

describe("hasPayload", () => {
  it.each([
    [undefined, false],
    [null, false],
    [{}, false],
    [{ text: "" }, false],
    [{ blocks: [] }, false],
    [{ text: "hi" }, true],
    [{ blocks: [{ type: "section" }] }, true],
    [{ text: "", blocks: [{ type: "section" }] }, true],
  ])("hasPayload(%j) -> %s", (input, expected) => {
    expect(hasPayload(input as any)).toBe(expected);
  });
});

describe("renderApprovalStatus", () => {
  it("renders remaining approvers and approvers list once someone approved", () => {
    const state = makeState({ approved: ["U1"] });
    const block = renderApprovalStatus(state);

    expect(block.type).toBe("section");
    const text = (block.text as { text: string }).text;
    expect(text).toContain("*Required Approvers Count:* 2");
    expect(text).toContain("*Remaining Approvers:* <@U2>");
    expect(text).toContain("Approvers: <@U1>");
  });

  it("omits the approvers line when no one has approved yet", () => {
    const state = makeState();
    const text = (renderApprovalStatus(state).text as { text: string }).text;
    expect(text).not.toMatch(/(^|\n)Approvers:/);
  });
});

describe("renderApprovalButtons", () => {
  it("renders Approve and Reject buttons before threshold is met", () => {
    const state = makeState();
    const block = renderApprovalButtons(state, buttons) as any;

    expect(block.type).toBe("actions");
    expect(block.elements).toHaveLength(2);
    expect(block.elements[0].action_id).toBe("slack-approval-approve-step");
    expect(block.elements[0].value).toBe("repo-wf-1-1-1");
    expect(block.elements[0].text.text).toContain("Approve (2 needed)");
    expect(block.elements[1].action_id).toBe("slack-approval-reject-step");
    expect(block.elements[1].style).toBe("danger");
  });

  it("renders a completion section once fully approved", () => {
    const state = makeState({ approved: ["U1", "U2"] });
    const block = renderApprovalButtons(state, buttons) as any;
    expect(block.type).toBe("section");
    expect(block.text.text).toContain("Approval Complete");
    expect(block.text.text).toContain("All 2 required approvals");
  });
});

describe("renderDefaultRequestBlocks", () => {
  it("includes header, fields, status, buttons in order", () => {
    const blocks = renderDefaultRequestBlocks(ctx, makeState(), buttons);
    expect(blocks).toHaveLength(4);
    expect(blocks[0].text.text).toBe("GitHub Actions Approval Request");
    expect(blocks[1].fields.some((f: any) => f.text.includes("alice"))).toBe(true);
    expect(blocks[1].fields.some((f: any) => f.text.includes(ctx.actionsUrl))).toBe(true);
    expect(blocks[2].type).toBe("section");
    expect(blocks[3].type).toBe("actions");
  });
});

describe("composeMainMessage", () => {
  it("appends status + buttons to a non-empty baseMessagePayload and adds a default text", () => {
    const base = { blocks: [{ type: "section", text: { type: "mrkdwn", text: "Deploy?" } }] };
    const result = composeMainMessage(base, ctx, makeState(), buttons, "step");

    expect(result.text).toBe("GitHub Actions Approval Request #step");
    expect(result.blocks).toHaveLength(3);
    expect(result.blocks[0].text.text).toBe("Deploy?");
    expect(result.blocks[1].type).toBe("section");
    expect(result.blocks[2].type).toBe("actions");
  });

  it("preserves a caller-supplied text on baseMessagePayload", () => {
    const base = { text: "custom", blocks: [{ type: "section" }] };
    expect(composeMainMessage(base, ctx, makeState(), buttons, "step").text).toBe("custom");
  });

  it("falls back to default request blocks when baseMessagePayload is empty", () => {
    const result = composeMainMessage({}, ctx, makeState(), buttons, "step");
    expect(result.text).toBeUndefined();
    expect(result.blocks).toHaveLength(4);
    expect(result.blocks[0].text.text).toBe("GitHub Actions Approval Request");
  });

  it("treats baseMessagePayload with only blocks=[] as empty", () => {
    const result = composeMainMessage({ blocks: [] }, ctx, makeState(), buttons, "step");
    expect(result.blocks).toHaveLength(4);
  });
});

describe("replaceTrailingStatusBlocks", () => {
  it("replaces only the last two blocks with refreshed status + buttons", () => {
    const original = [
      { type: "section", text: { type: "mrkdwn", text: "keep me" } },
      { type: "section", text: { type: "mrkdwn", text: "old status" } },
      { type: "actions", elements: [] },
    ];
    const result = replaceTrailingStatusBlocks(original, makeState({ approved: ["U1"] }), buttons);

    expect(result).toHaveLength(3);
    expect(result[0]).toBe(original[0]);
    expect(result[1].type).toBe("section");
    expect(result[1].text.text).toContain("Approvers: <@U1>");
    expect(result[2].type).toBe("actions");
  });
});

describe("renderRejectionBlock", () => {
  it("includes the user mention and a timestamp", () => {
    const block = renderRejectionBlock("U99");
    expect(block.type).toBe("section");
    expect((block.text as any).text).toContain("<@U99>");
    expect((block.text as any).text).toContain("Request Rejected");
  });
});
