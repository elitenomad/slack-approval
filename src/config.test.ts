import { describe, it, expect, vi, beforeEach } from "vitest";

const getInputMock = vi.fn();
const getMultilineInputMock = vi.fn();

vi.mock("@actions/core", () => ({
  getInput: (...args: any[]) => getInputMock(...args),
  getMultilineInput: (...args: any[]) => getMultilineInputMock(...args),
}));

import { loadConfig } from "./config";

function defaultInputs(): Record<string, string> {
  return {
    approvers: "U1,U2",
    minimumApprovalCount: "1",
    baseMessageTs: "",
  };
}

function defaultMultiline(): Record<string, string[]> {
  return {
    baseMessagePayload: ["{}"],
    successMessagePayload: ["{}"],
    failMessagePayload: ["{}"],
  };
}

function setupInputs(
  inputs: Record<string, string> = defaultInputs(),
  multiline: Record<string, string[]> = defaultMultiline(),
) {
  getInputMock.mockImplementation((name: string) => inputs[name] ?? "");
  getMultilineInputMock.mockImplementation((name: string) => multiline[name] ?? []);
}

beforeEach(() => {
  getInputMock.mockReset();
  getMultilineInputMock.mockReset();
});

describe("loadConfig", () => {
  it("reads slack env vars and falls back to empty strings", () => {
    setupInputs();
    const env: NodeJS.ProcessEnv = {
      SLACK_BOT_TOKEN: "xoxb-1",
      SLACK_SIGNING_SECRET: "sig",
      SLACK_APP_TOKEN: "xapp-1",
      SLACK_CHANNEL_ID: "C1",
      UNIQUE_STEP_ID: "step-a",
    };

    const config = loadConfig(env);

    expect(config.slack).toEqual({
      botToken: "xoxb-1",
      signingSecret: "sig",
      appToken: "xapp-1",
      channelId: "C1",
    });
    expect(config.uniqueStepId).toBe("step-a");
  });

  it("defaults missing slack env vars and uniqueStepId to empty strings", () => {
    setupInputs();
    const config = loadConfig({});
    expect(config.slack).toEqual({
      botToken: "",
      signingSecret: "",
      appToken: "",
      channelId: "",
    });
    expect(config.uniqueStepId).toBe("");
  });

  it("splits approvers by comma and parses minimumApprovalCount", () => {
    setupInputs({ ...defaultInputs(), approvers: "U1,U2,U3", minimumApprovalCount: "2" });
    const config = loadConfig({});
    expect(config.approval.requiredApprovers).toEqual(["U1", "U2", "U3"]);
    expect(config.approval.minimumApprovalCount).toBe(2);
  });

  it("defaults minimumApprovalCount to 1 when input is empty / non-numeric", () => {
    setupInputs({ ...defaultInputs(), minimumApprovalCount: "" });
    expect(loadConfig({}).approval.minimumApprovalCount).toBe(1);

    setupInputs({ ...defaultInputs(), minimumApprovalCount: "abc" });
    expect(loadConfig({}).approval.minimumApprovalCount).toBe(1);
  });

  it("throws when minimumApprovalCount exceeds the number of approvers", () => {
    setupInputs({ ...defaultInputs(), approvers: "U1", minimumApprovalCount: "2" });
    expect(() => loadConfig({})).toThrow(/Insufficient approvers/);
  });

  it("parses each payload input as JSON joined from multiline", () => {
    setupInputs(defaultInputs(), {
      baseMessagePayload: ['{"blocks":[', '{"type":"section"}', "]}"],
      successMessagePayload: ['{"text":"ok"}'],
      failMessagePayload: ['{"text":"nope"}'],
    });

    const config = loadConfig({});
    expect(config.approval.baseMessagePayload).toEqual({
      blocks: [{ type: "section" }],
    });
    expect(config.approval.successMessagePayload).toEqual({ text: "ok" });
    expect(config.approval.failMessagePayload).toEqual({ text: "nope" });
  });

  it("propagates JSON.parse errors for malformed payloads", () => {
    setupInputs(defaultInputs(), {
      ...defaultMultiline(),
      baseMessagePayload: ["{not json"],
    });
    expect(() => loadConfig({})).toThrow();
  });

  it("passes baseMessageTs through unchanged", () => {
    setupInputs({ ...defaultInputs(), baseMessageTs: "1700000000.000100" });
    expect(loadConfig({}).approval.baseMessageTs).toBe("1700000000.000100");
  });
});
