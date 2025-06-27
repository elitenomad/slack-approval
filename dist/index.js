"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
const core = __importStar(require("@actions/core"));
const bolt_1 = require("@slack/bolt");
const web_api_1 = require("@slack/web-api");
const token = process.env.SLACK_BOT_TOKEN || "";
const signingSecret = process.env.SLACK_SIGNING_SECRET || "";
const slackAppToken = process.env.SLACK_APP_TOKEN || "";
const channel_id = process.env.SLACK_CHANNEL_ID || "";
const unique_step_id = process.env.UNIQUE_STEP_ID || "";
console.log("unique_step_id", unique_step_id);
const baseMessageTs = core.getInput("baseMessageTs");
const requiredApprovers = (_a = core
    .getInput("approvers", { required: true, trimWhitespace: true })) === null || _a === void 0 ? void 0 : _a.split(",");
const minimumApprovalCount = Number(core.getInput("minimumApprovalCount")) || 1;
const baseMessagePayload = JSON.parse(core.getMultilineInput("baseMessagePayload").join(""));
const approvers = [];
const successMessagePayload = JSON.parse(core.getMultilineInput("successMessagePayload").join(""));
const failMessagePayload = JSON.parse(core.getMultilineInput("failMessagePayload").join(""));
const app = new bolt_1.App({
    token: token,
    signingSecret: signingSecret,
    appToken: slackAppToken,
    socketMode: true,
    port: 3000,
    logLevel: bolt_1.LogLevel.DEBUG,
});
if (minimumApprovalCount > requiredApprovers.length) {
    console.error("Error: Insufficient approvers. Minimum required approvers not met.");
    process.exit(1);
}
function hasPayload(inputs) {
    var _a, _b;
    return ((_a = inputs.text) === null || _a === void 0 ? void 0 : _a.length) > 0 || ((_b = inputs.blocks) === null || _b === void 0 ? void 0 : _b.length) > 0;
}
function run() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const web = new web_api_1.WebClient(token);
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
                            .join(", ")}\n${approvers.length > 0
                            ? `Approvers: ${approvers.map((v) => `<@${v}>`).join(", ")} `
                            : ""}\n`,
                    },
                };
            };
            const renderApprovalButtons = () => {
                const remainingApprovals = minimumApprovalCount - approvers.length;
                const isFullyApproved = approvers.length >= minimumApprovalCount;
                if (!isFullyApproved) {
                    return {
                        type: "actions",
                        elements: [
                            {
                                type: "button",
                                text: {
                                    type: "plain_text",
                                    emoji: true,
                                    text: `✅ Approve (${remainingApprovals} needed)`,
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
                                    text: "❌ Reject",
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
                        text: `🎉 *Approval Complete!* All ${minimumApprovalCount} required approvals have been received.`,
                    },
                };
            };
            const mainMessagePayload = hasPayload(baseMessagePayload)
                ? Object.assign(Object.assign({}, baseMessagePayload), { text: baseMessagePayload.text || "GitHub Actions Approval Request #${unique_step_id}", blocks: [...baseMessagePayload.blocks, renderApprovalStatus(), renderApprovalButtons()] }) : {
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
            function approve(userId) {
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
                ? yield web.chat.update(Object.assign({ channel: channel_id, ts: baseMessageTs }, mainMessagePayload))
                : yield web.chat.postMessage(Object.assign({ channel: channel_id }, mainMessagePayload));
            core.setOutput("mainMessageTs", mainMessage.ts);
            function cancelHandler() {
                return __awaiter(this, void 0, void 0, function* () {
                    yield web.chat.update(Object.assign({ ts: mainMessage.ts, channel: channel_id }, (hasPayload(failMessagePayload) ? failMessagePayload : mainMessagePayload)));
                    process.exit(1);
                });
            }
            process.on("SIGTERM", cancelHandler);
            process.on("SIGINT", cancelHandler);
            process.on("SIGBREAK", cancelHandler);
            app.action(`slack-approval-approve-${unique_step_id}`, ({ ack, client, body, logger, action }) => __awaiter(this, void 0, void 0, function* () {
                var _a, _b, _c, _d, _e, _f;
                try {
                    yield ack();
                    // Validate action type
                    if (action.type !== "button") {
                        logger.warn(`Invalid action type: ${action.type}`);
                        return;
                    }
                    // Validate action value
                    if (action.value !== aid) {
                        logger.warn(`Invalid action value: ${action.value}, expected: ${aid}`);
                        return;
                    }
                    const userId = (_a = body.user) === null || _a === void 0 ? void 0 : _a.id;
                    const userName = ((_b = body.user) === null || _b === void 0 ? void 0 : _b.name) || ((_c = body.user) === null || _c === void 0 ? void 0 : _c.username) || 'Unknown User';
                    const channelId = (_d = body.channel) === null || _d === void 0 ? void 0 : _d.id;
                    logger.info(`Approval request from user: ${userName} (${userId}) in channel: ${channelId}`);
                    // Check if user is authorized to approve
                    if (!userId) {
                        logger.error("No user ID found in request body");
                        return;
                    }
                    // Check if user has already approved
                    if (approvers.includes(userId)) {
                        logger.info(`User ${userName} (${userId}) has already approved`);
                        // Send ephemeral message to user
                        yield client.chat.postEphemeral({
                            channel: channelId || "",
                            user: userId,
                            text: "You have already approved this request.",
                        });
                        return;
                    }
                    // Check if user is in the required approvers list
                    if (!requiredApprovers.includes(userId)) {
                        logger.warn(`Unauthorized approval attempt by user: ${userName} (${userId})`);
                        // Send ephemeral message to user
                        yield client.chat.postEphemeral({
                            channel: channelId || "",
                            user: userId,
                            text: "You are not authorized to approve this request.",
                        });
                        return;
                    }
                    const approveResult = approve(userId);
                    logger.info(`Approval result for ${userName}: ${approveResult}`);
                    // Update the main message
                    try {
                        if (approveResult === "approved") {
                            logger.info(`Request fully approved by ${userName}. Exiting with success.`);
                            yield client.chat.update(Object.assign({ ts: mainMessage.ts || "", channel: channelId || "" }, (hasPayload(successMessagePayload)
                                ? successMessagePayload
                                : mainMessagePayload)));
                            // Send confirmation to the approver
                            yield client.chat.postEphemeral({
                                channel: channelId || "",
                                user: userId,
                                text: `✅ You approved the request. All required approvals have been received!`,
                            });
                        }
                        else if (approveResult === "remainApproval") {
                            logger.info(`Partial approval by ${userName}. ${minimumApprovalCount - approvers.length} more approvals needed.`);
                            yield client.chat.update({
                                channel: channelId || "",
                                ts: (mainMessage === null || mainMessage === void 0 ? void 0 : mainMessage.ts) || "",
                                text: "",
                                blocks: [
                                    ...mainMessagePayload.blocks.slice(0, -2),
                                    renderApprovalStatus(),
                                    renderApprovalButtons(),
                                ],
                            });
                            // Send confirmation to the approver
                            yield client.chat.postEphemeral({
                                channel: channelId || "",
                                user: userId,
                                text: `✅ You approved the request. ${minimumApprovalCount - approvers.length} more approval(s) needed.`,
                            });
                        }
                        else {
                            logger.warn(`Unexpected approval result: ${approveResult}`);
                        }
                    }
                    catch (updateError) {
                        logger.error(`Failed to update message: ${updateError}`);
                        // Send error notification to user
                        yield client.chat.postEphemeral({
                            channel: channelId || "",
                            user: userId,
                            text: "❌ Failed to update the approval message. Please try again.",
                        });
                    }
                    // Exit if fully approved
                    if (approveResult === "approved") {
                        process.exit(0);
                    }
                }
                catch (error) {
                    logger.error(`Error in approval action handler: ${error}`);
                    // Try to send error notification to user if possible
                    try {
                        const userId = (_e = body.user) === null || _e === void 0 ? void 0 : _e.id;
                        const channelId = (_f = body.channel) === null || _f === void 0 ? void 0 : _f.id;
                        if (userId && channelId) {
                            yield client.chat.postEphemeral({
                                channel: channelId,
                                user: userId,
                                text: "❌ An error occurred while processing your approval. Please try again.",
                            });
                        }
                    }
                    catch (ephemeralError) {
                        logger.error(`Failed to send error notification: ${ephemeralError}`);
                    }
                }
            }));
            app.action(`slack-approval-reject-${unique_step_id}`, ({ ack, client, body, logger, action }) => __awaiter(this, void 0, void 0, function* () {
                var _g, _h, _j, _k, _l, _m;
                try {
                    yield ack();
                    // Validate action type
                    if (action.type !== "button") {
                        logger.warn(`Invalid reject action type: ${action.type}`);
                        return;
                    }
                    // Validate action value
                    if (action.value !== aid) {
                        logger.warn(`Invalid reject action value: ${action.value}, expected: ${aid}`);
                        return;
                    }
                    const userId = (_g = body.user) === null || _g === void 0 ? void 0 : _g.id;
                    const userName = ((_h = body.user) === null || _h === void 0 ? void 0 : _h.name) || ((_j = body.user) === null || _j === void 0 ? void 0 : _j.username) || 'Unknown User';
                    const channelId = (_k = body.channel) === null || _k === void 0 ? void 0 : _k.id;
                    logger.info(`Rejection request from user: ${userName} (${userId}) in channel: ${channelId}`);
                    // Check if user ID exists
                    if (!userId) {
                        logger.error("No user ID found in reject request body");
                        return;
                    }
                    // Check if user is authorized to reject (anyone in required approvers can reject)
                    if (!requiredApprovers.includes(userId) && !approvers.includes(userId)) {
                        logger.warn(`Unauthorized rejection attempt by user: ${userName} (${userId})`);
                        // Send ephemeral message to user
                        yield client.chat.postEphemeral({
                            channel: channelId || "",
                            user: userId,
                            text: "You are not authorized to reject this request.",
                        });
                        return;
                    }
                    // Check if request is already fully approved
                    if (approvers.length >= minimumApprovalCount) {
                        logger.info(`Rejection attempt by ${userName} after request was already approved`);
                        // Send ephemeral message to user
                        yield client.chat.postEphemeral({
                            channel: channelId || "",
                            user: userId,
                            text: "This request has already been approved and cannot be rejected.",
                        });
                        return;
                    }
                    logger.info(`Request rejected by ${userName}. Exiting with failure.`);
                    // Update the main message with rejection
                    try {
                        yield client.chat.update(Object.assign({ ts: mainMessage.ts || "", channel: channelId || "" }, (hasPayload(failMessagePayload) ? failMessagePayload : {
                            text: `❌ Request rejected by <@${userId}>`,
                            blocks: [
                                ...mainMessagePayload.blocks.slice(0, -2),
                                {
                                    type: "section",
                                    text: {
                                        type: "mrkdwn",
                                        text: `❌ *Request Rejected*\nRejected by <@${userId}> on ${new Date().toLocaleString()}`,
                                    },
                                },
                            ],
                        })));
                        // Send confirmation to the rejector
                        yield client.chat.postEphemeral({
                            channel: channelId || "",
                            user: userId,
                            text: `❌ You rejected the request. The approval process has been cancelled.`,
                        });
                    }
                    catch (updateError) {
                        logger.error(`Failed to update message with rejection: ${updateError}`);
                        // Send error notification to user
                        yield client.chat.postEphemeral({
                            channel: channelId || "",
                            user: userId,
                            text: "❌ Failed to update the rejection message. The request will still be rejected.",
                        });
                    }
                    // Exit with failure code
                    process.exit(1);
                }
                catch (error) {
                    logger.error(`Error in rejection action handler: ${error}`);
                    // Try to send error notification to user if possible
                    try {
                        const userId = (_l = body.user) === null || _l === void 0 ? void 0 : _l.id;
                        const channelId = (_m = body.channel) === null || _m === void 0 ? void 0 : _m.id;
                        if (userId && channelId) {
                            yield client.chat.postEphemeral({
                                channel: channelId,
                                user: userId,
                                text: "❌ An error occurred while processing your rejection. Please try again.",
                            });
                        }
                    }
                    catch (ephemeralError) {
                        logger.error(`Failed to send error notification: ${ephemeralError}`);
                    }
                    // Still exit with failure even if there was an error
                    process.exit(1);
                }
            }));
            (() => __awaiter(this, void 0, void 0, function* () {
                yield app.start(3000);
                console.log("Waiting Approval reaction.....");
            }))();
        }
        catch (error) {
            if (error instanceof Error)
                core.setFailed(error.message);
        }
    });
}
run();
