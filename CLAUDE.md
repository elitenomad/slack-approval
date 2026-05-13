# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A composite GitHub Action (Node 20, TypeScript) that posts a Slack message with Approve/Reject buttons and blocks the workflow step until enough approvers click Approve (success → exit 0) or someone clicks Reject / the job is cancelled (failure → exit 1).

## Build & development

- `yarn build` (or `npm run build`) — compiles `src/index.ts` → `dist/` via `tsc`. No bundler (no ncc/esbuild).
- `yarn watch` — `tsc -w`.
- There are no tests, no linter, no formatter configured.

Because there's no bundler, the action depends on `node_modules` being present at runtime. The test workflow (`.github/workflows/slack-approval-test.yml`) runs `npm install` in the consuming job before `uses: ./`. Anyone consuming this action from another repo must do the same, or this repo needs to start bundling `dist/` with ncc. **The `dist/` directory is committed** and `action.yml` points at `dist/index.js` — rebuild and commit `dist/` whenever `src/index.ts` changes.

## Architecture

Single source file: `src/index.ts`. Everything runs in one process per action invocation.

**Runtime model — Slack Socket Mode, not webhooks.** The action starts a `@slack/bolt` `App` in socket mode (port 3000, but the port is irrelevant — socket mode opens an outbound WebSocket to Slack). This is what lets the action receive button clicks from a GitHub Actions runner with no public ingress. The process stays alive listening for actions and only exits when:
- Approval threshold met → `process.exit(0)`
- Reject button clicked → `process.exit(1)`
- `SIGTERM` / `SIGINT` / `SIGBREAK` (job cancel / timeout) → `cancelHandler` updates the Slack message with `failMessagePayload` then `process.exit(1)`

**State is purely in-memory.** `requiredApprovers` and `approvers` are module-level arrays mutated by the action handlers. There is no persistence — if the process restarts, approval state is lost. This is intentional: each workflow run is one process.

**Action-ID scoping.** Button `action_id`s are suffixed with `UNIQUE_STEP_ID` (`slack-approval-approve-${unique_step_id}`, `slack-approval-reject-${unique_step_id}`). This is what allows multiple parallel approval steps in the same workflow without their button handlers colliding — every caller must pass a distinct `UNIQUE_STEP_ID` env var. The test workflow demonstrates this with three jobs using `"one"`, `"security"`, `"qa"`.

**Button-value scoping.** The button `value` is `aid = ${repo}-${workflow}-${run_id}-${run_number}-${run_attempt}`. Handlers reject clicks whose `value !== aid`, so stale buttons from earlier runs cannot trigger a new run's handler.

**Message lifecycle.**
- If `baseMessageTs` input is set, the action *updates* that existing message (used to chain approval steps onto a single Slack thread). Otherwise it `chat.postMessage`s a new one and emits its `ts` via the `mainMessageTs` output.
- The rendered message = `baseMessagePayload.blocks` + a status block (remaining approvers, count) + an actions block (the two buttons), OR a fallback default-blocks layout if `baseMessagePayload` is empty (checked via `hasPayload`, which looks at `.text` or `.blocks`).
- On partial approval the last two blocks (status + buttons) are re-rendered. On full approval the message is replaced by `successMessagePayload` (or kept as-is if empty). On reject, replaced by `failMessagePayload` (or a default "Request Rejected" block).
- Approvers list is maintained by splicing the approving user out of `requiredApprovers` and pushing into `approvers`. Self-double-approval is blocked with an ephemeral message.

## Configuration surface

Env vars (required, read at startup): `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_APP_TOKEN` (must be `xapp-` app-level token, socket mode requires it), `SLACK_CHANNEL_ID`, `UNIQUE_STEP_ID`.

Action inputs: `approvers` (CSV of Slack user IDs, required), `minimumApprovalCount`, `baseMessageTs`, `baseMessagePayload`, `successMessagePayload`, `failMessagePayload`. The three payload inputs are parsed as JSON (`getMultilineInput(...).join("")`) — they must be valid JSON or the action throws at startup.

The Slack App needs socket mode enabled and the scopes listed in the README's App Manifest. See README.md for the manifest JSON.
