import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApprovalState } from "./state";
import { createApproveHandler, createRejectHandler, HandlerDeps } from "./handlers";
import type { ApprovalConfig } from "./config";

interface Harness {
  state: ApprovalState;
  deps: HandlerDeps;
  ack: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  postEphemeral: ReturnType<typeof vi.fn>;
  exit: ReturnType<typeof vi.fn>;
  client: any;
  logger: {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    debug: ReturnType<typeof vi.fn>;
  };
}

function makeApprovalConfig(overrides: Partial<ApprovalConfig> = {}): ApprovalConfig {
  return {
    baseMessageTs: "",
    requiredApprovers: ["U1", "U2"],
    minimumApprovalCount: 1,
    baseMessagePayload: {},
    successMessagePayload: {},
    failMessagePayload: {},
    ...overrides,
  };
}

function buildHarness(opts?: {
  required?: string[];
  minimum?: number;
  approval?: Partial<ApprovalConfig>;
  mainTs?: string;
}): Harness {
  const state = new ApprovalState({
    requiredApprovers: opts?.required ?? ["U1", "U2"],
    minimumApprovalCount: opts?.minimum ?? 1,
  });

  const update = vi.fn().mockResolvedValue({ ok: true });
  const postEphemeral = vi.fn().mockResolvedValue({ ok: true });
  const ack = vi.fn().mockResolvedValue(undefined);
  const exit = vi.fn();

  const client = {
    chat: { update, postEphemeral },
  };

  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const deps: HandlerDeps = {
    state,
    mainMessage: { ts: opts?.mainTs ?? "1700.000" },
    mainMessagePayload: {
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: "header" } },
        { type: "section", text: { type: "mrkdwn", text: "status placeholder" } },
        { type: "actions", elements: [] },
      ],
    },
    buttons: { aid: "AID", uniqueStepId: "step" },
    approval: makeApprovalConfig(opts?.approval),
    exit: exit as unknown as (code: number) => never,
  };

  return { state, deps, ack, update, postEphemeral, exit, client, logger };
}

function buttonAction(value = "AID") {
  return { type: "button", value, action_id: "x" } as any;
}

function buildArgs(h: Harness, action: any, userOverride?: any) {
  return {
    ack: h.ack,
    client: h.client,
    body: {
      user: userOverride === undefined ? { id: "U1", name: "alice" } : userOverride,
      channel: { id: "C1" },
    },
    logger: h.logger,
    action,
  } as any;
}

beforeEach(() => {
  vi.useRealTimers();
});

describe("createApproveHandler", () => {
  it("calls ack and approves when a required user clicks; threshold met -> exit(0) and writes successMessage", async () => {
    const h = buildHarness({
      approval: { successMessagePayload: { text: "yay", blocks: [{ type: "section" }] } },
    });

    await createApproveHandler(h.deps)(buildArgs(h, buttonAction()));

    expect(h.ack).toHaveBeenCalledOnce();
    expect(h.update).toHaveBeenCalledOnce();
    expect(h.update.mock.calls[0][0]).toMatchObject({
      ts: "1700.000",
      channel: "C1",
      text: "yay",
    });
    expect(h.exit).toHaveBeenCalledExactlyOnceWith(0);
    expect(h.state.isFullyApproved).toBe(true);
  });

  it("falls back to mainMessagePayload when successMessagePayload is empty", async () => {
    const h = buildHarness();
    await createApproveHandler(h.deps)(buildArgs(h, buttonAction()));

    const call = h.update.mock.calls[0][0];
    expect(call.blocks).toEqual(h.deps.mainMessagePayload.blocks);
    expect(call.text).toBeUndefined();
    expect(h.exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it("on partial approval, replaces trailing status blocks and does NOT exit", async () => {
    const h = buildHarness({ required: ["U1", "U2"], minimum: 2 });
    await createApproveHandler(h.deps)(buildArgs(h, buttonAction()));

    expect(h.update).toHaveBeenCalledOnce();
    const call = h.update.mock.calls[0][0];
    expect(call.blocks).toHaveLength(3);
    expect(call.blocks[0]).toEqual(h.deps.mainMessagePayload.blocks[0]);
    expect(call.blocks[1].text.text).toContain("Approvers: <@U1>");
    expect(h.exit).not.toHaveBeenCalled();
  });

  it("ignores clicks whose action.value !== aid and logs a warning", async () => {
    const h = buildHarness();
    await createApproveHandler(h.deps)(buildArgs(h, buttonAction("STALE")));

    expect(h.ack).toHaveBeenCalledOnce();
    expect(h.update).not.toHaveBeenCalled();
    expect(h.exit).not.toHaveBeenCalled();
    expect(h.logger.warn).toHaveBeenCalled();
  });

  it("ignores non-button action types", async () => {
    const h = buildHarness();
    await createApproveHandler(h.deps)(buildArgs(h, { type: "static_select", value: "AID" } as any));

    expect(h.update).not.toHaveBeenCalled();
    expect(h.logger.warn).toHaveBeenCalled();
  });

  it("returns silently when body.user.id is missing", async () => {
    const h = buildHarness();
    await createApproveHandler(h.deps)(buildArgs(h, buttonAction(), { name: "nope" }));

    expect(h.update).not.toHaveBeenCalled();
    expect(h.exit).not.toHaveBeenCalled();
    expect(h.logger.error).toHaveBeenCalled();
  });

  it("sends ephemeral and short-circuits when user has already approved", async () => {
    const h = buildHarness({ required: ["U1", "U2"], minimum: 2 });
    h.state.approve("U1");

    await createApproveHandler(h.deps)(buildArgs(h, buttonAction()));

    expect(h.update).not.toHaveBeenCalled();
    expect(h.postEphemeral).toHaveBeenCalledOnce();
    expect(h.postEphemeral.mock.calls[0][0].text).toMatch(/already approved/i);
    expect(h.exit).not.toHaveBeenCalled();
  });

  it("sends ephemeral and short-circuits when user is not an approver", async () => {
    const h = buildHarness({ required: ["U2"] });
    await createApproveHandler(h.deps)(buildArgs(h, buttonAction()));

    expect(h.update).not.toHaveBeenCalled();
    expect(h.postEphemeral).toHaveBeenCalledOnce();
    expect(h.postEphemeral.mock.calls[0][0].text).toMatch(/not authorized/i);
    expect(h.exit).not.toHaveBeenCalled();
  });

  it("when client.chat.update throws on full approval, logs + posts ephemeral but still exits(0) since state is already approved", async () => {
    const h = buildHarness();
    h.update.mockRejectedValueOnce(new Error("slack 5xx"));

    await createApproveHandler(h.deps)(buildArgs(h, buttonAction()));

    expect(h.logger.error).toHaveBeenCalled();
    expect(h.postEphemeral).toHaveBeenCalledOnce();
    expect(h.exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it("swallows postEphemeral errors", async () => {
    const h = buildHarness({ required: ["U2"] });
    h.postEphemeral.mockRejectedValueOnce(new Error("boom"));

    await expect(
      createApproveHandler(h.deps)(buildArgs(h, buttonAction())),
    ).resolves.toBeUndefined();
    expect(h.logger.error).toHaveBeenCalled();
  });
});

describe("createRejectHandler", () => {
  it("updates message with failMessagePayload and exits(1)", async () => {
    const h = buildHarness({
      approval: { failMessagePayload: { text: "denied", blocks: [{ type: "section" }] } },
    });

    await createRejectHandler(h.deps)(buildArgs(h, buttonAction()));

    expect(h.ack).toHaveBeenCalledOnce();
    expect(h.update).toHaveBeenCalledOnce();
    expect(h.update.mock.calls[0][0]).toMatchObject({
      ts: "1700.000",
      channel: "C1",
      text: "denied",
    });
    expect(h.exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("when failMessagePayload is empty, posts default rejection block and exits(1)", async () => {
    const h = buildHarness();
    await createRejectHandler(h.deps)(buildArgs(h, buttonAction()));

    const call = h.update.mock.calls[0][0];
    expect(call.text).toContain("<@U1>");
    expect(call.blocks).toHaveLength(2);
    expect(call.blocks[0]).toEqual(h.deps.mainMessagePayload.blocks[0]);
    expect(call.blocks[1].text.text).toContain("Request Rejected");
    expect(h.exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("blocks unauthorized rejection with ephemeral and does NOT exit", async () => {
    const h = buildHarness({ required: ["U2"] });
    await createRejectHandler(h.deps)(buildArgs(h, buttonAction()));

    expect(h.update).not.toHaveBeenCalled();
    expect(h.postEphemeral).toHaveBeenCalledOnce();
    expect(h.postEphemeral.mock.calls[0][0].text).toMatch(/not authorized/i);
    expect(h.exit).not.toHaveBeenCalled();
  });

  it("blocks rejection after full approval with ephemeral and does NOT exit", async () => {
    const h = buildHarness();
    h.state.approve("U1");

    await createRejectHandler(h.deps)(buildArgs(h, buttonAction()));

    expect(h.update).not.toHaveBeenCalled();
    expect(h.postEphemeral).toHaveBeenCalledOnce();
    expect(h.postEphemeral.mock.calls[0][0].text).toMatch(/already been approved/i);
    expect(h.exit).not.toHaveBeenCalled();
  });

  it("ignores stale-aid clicks and logs a warning", async () => {
    const h = buildHarness();
    await createRejectHandler(h.deps)(buildArgs(h, buttonAction("STALE")));

    expect(h.update).not.toHaveBeenCalled();
    expect(h.exit).not.toHaveBeenCalled();
    expect(h.logger.warn).toHaveBeenCalled();
  });

  it("when chat.update throws, still exits(1) after posting ephemeral", async () => {
    const h = buildHarness();
    h.update.mockRejectedValueOnce(new Error("slack 5xx"));

    await createRejectHandler(h.deps)(buildArgs(h, buttonAction()));

    expect(h.postEphemeral).toHaveBeenCalledOnce();
    expect(h.exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("returns silently when body.user.id is missing", async () => {
    const h = buildHarness();
    await createRejectHandler(h.deps)(buildArgs(h, buttonAction(), { name: "nope" }));

    expect(h.update).not.toHaveBeenCalled();
    expect(h.exit).not.toHaveBeenCalled();
    expect(h.logger.error).toHaveBeenCalled();
  });
});
