import { Render } from "@renderinc/sdk";
import { createApp } from "./app.js";
import { loadCatalog } from "./catalog.js";
import { required } from "./config.js";
import { Requests } from "./requests.js";
import { slackClient, verifyWorkspace } from "./slack.js";

const report = (event: string, fields: Record<string, unknown>) => {
  console.log(JSON.stringify({ event, ...fields }));
};

const teamId = required("SLACK_TEAM_ID");
const client = slackClient();
const { botId, botUserId } = await verifyWorkspace(client, teamId);
const catalog = await loadCatalog(client.emoji.list);
report("catalog_loaded", { size: catalog.names.length });
const workflowTask = required("EMOJI_FINDER_WORKFLOW_TASK");
const render = new Render();
const requests = new Requests(async (request) => {
  // Bound HTTP acceptance to Slack's acknowledgment window, not the task's lifetime.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const run = await render.workflows.startTask(workflowTask, [request, catalog.entries], controller.signal);
    report("request_submitted", { requestId: request.requestId, runId: run.taskRunId });
    return run.taskRunId;
  } finally {
    clearTimeout(timer);
  }
});

const { app } = createApp({
  signingSecret: required("SLACK_SIGNING_SECRET"),
  teamId,
  botToken: required("SLACK_BOT_TOKEN"),
  botId,
  botUserId,
}, (request) => requests.accept(request));

const port = Number(process.env.PORT ?? process.env.EMOJI_FINDER_PORT ?? "3000");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid port");
await app.start(port);
report("web_started", { port });

async function shutdown() {
  await app.stop();
  report("web_stopped", {});
  process.exit(0);
}
process.once("SIGTERM", () => { void shutdown(); });
process.once("SIGINT", () => { void shutdown(); });
