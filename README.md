# slack-approval

A GitHub Action that pauses a workflow until the right people approve it in Slack.

## Why this fork

This is a maintained fork of [TigerWest/slack-approval](https://github.com/TigerWest/slack-approval), which has had no updates since November 2024. I fixed the issues that stopped it working as a deployment gate and released the changes as v1.0.4 to v1.0.8:

- The "Approve" and "Reject" buttons sit in the main message instead of a thread reply.
- Button IDs include `UNIQUE_STEP_ID`, so one workflow can run several approval steps in parallel.
- Approve and reject each update the message with your own `successMessagePayload` or `failMessagePayload`, and fall back to the base message when those aren't set.


## trigger
<image src="img/approve_at_reply.png" width="800" height="300" />

- When the action runs, it posts a message to Slack (or updates the one given in `baseMessageTs`) with "Approve" and "Reject" buttons
## approve
<image src="img/approved.png" width="800" height="100" />

- Clicking on "Approve" will execute next steps

## reject and cancel
<image src="img/rejected.png" width="800" height="100" />
<image src="img/canceled.png" width="800" height="100" />

- Clicking on "Reject" or "cancel workflow" will cause workflow to fail and update the message





# How To Use

- First, create a Slack App and install in your workspace.
- Second. set the `App Manifest`
```json
{
    "display_information": {
        "name": "ApprveApp"
    },
    "features": {
        "bot_user": {
            "display_name": "ApproveApp",
            "always_online": false
        }
    },
    "oauth_config": {
        "scopes": {
            "bot": [
                "app_mentions:read",
                "channels:join",
                "chat:write",
                "users:read"
            ]
        }
    },
    "settings": {
        "interactivity": {
            "is_enabled": true
        },
        "org_deploy_enabled": false,
        "socket_mode_enabled": true,
        "token_rotation_enabled": false
    }
}
```

- set workflow step
```yaml
jobs:
  approval:
    runs-on: ubuntu-latest
    steps:
      - name: send approval
        uses: elitenomad/slack-approval@v1.0.8
        env:
          SLACK_APP_TOKEN: ${{ secrets.SLACK_APP_TOKEN }}
          SLACK_BOT_TOKEN: ${{ secrets.SLACK_BOT_TOKEN }}
          SLACK_SIGNING_SECRET: ${{ secrets.SLACK_SIGNING_SECRET }}
          SLACK_CHANNEL_ID: ${{ secrets.SLACK_CHANNEL_ID }}
          UNIQUE_STEP_ID: "1234"
        timeout-minutes: 5
        with:
            approvers: user1,user2
            minimumApprovalCount: 2
            baseMessagePayload: |
              {}
            successMessagePayload: |
              {}
            failMessagePayload: |
              {}
```

## Set environment variables

  - `SLACK_APP_TOKEN`

    - App-level tokens on `Basic Information page`. (starting with `xapp-` )

  - `SLACK_BOT_TOKEN`

    - Bot-level tokens on `OAuth & Permissions page`. (starting with `xoxb-` )

  - `SLACK_SIGNING_SECRET`

    - Signing Secret on `Basic Information page`.

  - `SLACK_CHANNEL_ID`

    - Channel ID for which you want to send approval.

  - `UNIQUE_STEP_ID`

    - UNIQUE ID to differentiate the value of the html input elements

## Set Inputs

  - `baseMessageTs`
    - If provided, updates the target message. If not provided, creates a new message
    - Optional

  - `approvers`
    - A comma-separated list of approvers' slack user ids
    - Required

  - `minimumApprovalCount`
    - The minimum number of approvals required
    - Optional (default: "1")

  - `baseMessagePayload`
    - The base message payload to display. If not set, will use default message from README. To customize, provide Slack message payload JSON
    - Optional (default: "{}")

  - `successMessagePayload`
    - The message body indicating approval is success. If not set, will use baseMessagePayload.
    - Optional (default: "{}")

  - `failMessagePayload`
    - The message body indicating approval is fail. If not set, will use baseMessagePayload.
    - Optional (default: "{}")


## outputs

- `mainMessageTs`
  - Timestamp of the main message sent to Slack

