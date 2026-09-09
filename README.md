# Emoji Finder

DM the Slack bot with a phrase, situation, or feeling. It replies in a thread with matching custom emoji. Reply with “more sarcastic”, “give me 20”, or “the best one” to refine the results. Each top-level DM starts a separate conversation.

Built with TypeScript, Slack Bolt, Anthropic, and Render Workflows. A web service receives signed Slack events; workflow tasks find emoji and deliver replies. Slack threads store conversation history. The emoji catalog loads at startup; restart the web service to refresh it.

## Run locally

Install [Nix](https://nixos.org/download/) with flakes enabled, [direnv](https://direnv.net/docs/installation.html) with its shell hook, and the [1Password CLI](https://developer.1password.com/docs/cli/get-started/). Nix supplies Node.js 24 and the Render CLI.

```sh
direnv allow
npm ci
```

Create a Slack app from [slack-manifest.json](slack-manifest.json) in [Slack app settings](https://api.slack.com/apps), then install it in a test workspace. Store its bot token, signing secret, and your Anthropic key in 1Password.

Create the ignored `.envrc.local` file, replacing the references and workspace ID:

```sh
export SLACK_BOT_TOKEN='op://VAULT/BOT_TOKEN_ITEM/credential'
export SLACK_SIGNING_SECRET='op://VAULT/SIGNING_SECRET_ITEM/credential'
export SLACK_TEAM_ID='YOUR_TEST_WORKSPACE_ID'
export EMOJI_FINDER_API_KEY='op://VAULT/ANTHROPIC_KEY_ITEM/credential'
export EMOJI_FINDER_MODEL='claude-haiku-4-5-20251001'
export RENDER_USE_LOCAL_DEV=true
export EMOJI_FINDER_WORKFLOW_TASK=fulfillRequest
```

Keep credential values in 1Password. The development commands resolve references through `op run`; the app reads only environment variables.

Reload the environment and start the workflow server:

```sh
direnv reload
npm run dev:workflow
```

In another terminal in the project directory:

```sh
npm run dev
```

Expose port **3000** through an HTTPS tunnel. In Slack's **Event Subscriptions**, set the Request URL to `https://YOUR-HOST/slack/events`, subscribe to `message.im`, and save. DM the bot to test it.

## Deploy to Render

Deploy both resources from the same repository with `NODE_VERSION=24` and build command `npm ci --include=dev && npm run build`:

| Resource | Start command | Required environment variables |
| --- | --- | --- |
| Workflow | `npm run start:workflow` | `SLACK_BOT_TOKEN`, `SLACK_TEAM_ID`, `EMOJI_FINDER_API_KEY`, `EMOJI_FINDER_MODEL` |
| Web service | `npm start` | `SLACK_BOT_TOKEN`, `SLACK_TEAM_ID`, `SLACK_SIGNING_SECRET`, `RENDER_API_KEY`, `EMOJI_FINDER_WORKFLOW_TASK` |

[render.yaml](render.yaml) configures the web service. Create the [Workflow separately](https://render.com/docs/workflows), then set the web service's task identifier to `WORKFLOW-SLUG/fulfillRequest`.

Supply actual credential values through Render's Environment settings and choose **Save and rebuild** after changes. Omit local development variables. `RENDER_API_KEY` authenticates workflow submissions; `EMOJI_FINDER_API_KEY` authenticates Anthropic requests.

Once deployed, update Slack's Request URL to the web service's `/slack/events` endpoint. `/healthz` returns `200` when the web service is ready.

## Development

```sh
npm run check
npm test
npm run build
```

Tests use fake responses and need no credentials. Compiled files go in the ignored `dist/` directory.

## Operational notes

- Anthropic receives the emoji catalog and conversation history. Render retains task inputs and results.
- There is no per-user allowlist or usage limit; workspace users who can DM the bot can generate paid requests.
- Retries check for an existing bot reply before sending. Duplicate replies remain possible, and concurrent requests can finish out of order.
