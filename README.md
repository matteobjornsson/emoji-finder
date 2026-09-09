# Emoji Finder

DM the Slack bot with a phrase, situation, or feeling. It replies in a thread with matching custom emoji. Reply with “more sarcastic”, “give me 20”, or “the best one” to refine the results. Each top-level DM starts a separate conversation.

Built with TypeScript, Slack Bolt, Anthropic, and Render Workflows. A web service receives signed Slack events; workflow tasks find emoji and deliver replies. Slack threads store conversation history. The emoji catalog loads at startup; restart the web service to refresh it.

## Run locally

Requires **Node.js 24** and the [Render CLI](https://render.com/docs/cli). Alternatively, the included Nix development shell supplies both (`direnv allow` or `nix develop ./nix#dev`).

```sh
npm ci
```

Create a Slack app from [slack-manifest.json](slack-manifest.json) in [Slack app settings](https://api.slack.com/apps), then install it in a test workspace.

Provide these environment variables to the processes that need them, using your preferred local environment setup:

| Variable | Value | Used by |
| --- | --- | --- |
| `SLACK_BOT_TOKEN` | Slack Bot User OAuth Token (`xoxb-…`) | Both |
| `SLACK_TEAM_ID` | Slack workspace ID (`T…`) | Both |
| `SLACK_SIGNING_SECRET` | App signing secret from Slack's Basic Information page | Web |
| `EMOJI_FINDER_API_KEY` | Anthropic API key | Workflow |
| `EMOJI_FINDER_MODEL` | Anthropic model ID, e.g. `claude-haiku-4-5-20251001` | Workflow |
| `EMOJI_FINDER_WORKFLOW_TASK` | `fulfillRequest` locally; `WORKFLOW-SLUG/fulfillRequest` when deployed | Web |
| `RENDER_API_KEY` | Render API key for submitting workflow tasks; required only when deployed | Web |

For local development, also set `RENDER_USE_LOCAL_DEV=true` in the web process. Start the workflow server:

```sh
npm run dev:workflow
```

In another terminal in the project directory:

```sh
npm run dev
```

Expose port **3000** through an HTTPS tunnel. In Slack's **Event Subscriptions**, set the Request URL to `https://YOUR-HOST/slack/events`, subscribe to `message.im`, and save. DM the bot to test it.

## Deploy to Render

Deploy both resources from the same repository with `NODE_VERSION=24` and build command `npm ci --include=dev && npm run build`:

| Resource | Start command |
| --- | --- |
| Workflow | `npm run start:workflow` |
| Web service | `npm start` |

[render.yaml](render.yaml) configures the web service. Create the [Workflow separately](https://render.com/docs/workflows), then set the web service's task identifier to `WORKFLOW-SLUG/fulfillRequest`.

Set each resource's variables from the table above in Render's Environment settings and choose **Save and rebuild** after changes. Omit `RENDER_USE_LOCAL_DEV` on Render.

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
