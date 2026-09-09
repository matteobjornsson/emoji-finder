import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import type { TaskContext } from "@renderinc/sdk/workflows";
import { WebClient } from "@slack/web-api";
import { Catalog } from "../src/catalog.js";
import { fulfillRequest, generate } from "../src/workflow.js";

const request = {
  requestId: "Ev123", teamId: "T123", channelId: "D123", threadTs: "123.001", messageTs: "123.001", query: "panic",
};
const catalog = Catalog.fromSlack({ panic: "panic.png" }).entries;

function configureWorkspace(t: TestContext) {
  const previous = process.env.SLACK_TEAM_ID;
  process.env.SLACK_TEAM_ID = "T123";
  t.after(() => {
    if (previous === undefined) delete process.env.SLACK_TEAM_ID;
    else process.env.SLACK_TEAM_ID = previous;
  });
}

test("orchestration passes the catalog snapshot to generation and its answer to delivery", async (t) => {
  configureWorkspace(t);
  const calls: { name: string; args: unknown[] }[] = [];
  const receipt = { requestId: "Ev123", channelId: "D123", messageTs: "123.002" };
  const ctx: TaskContext = {
    run: async (task, ...args) => {
      calls.push({ name: task.name, args });
      return (task.name === "findEmoji" ? ":panic:" : receipt) as never;
    },
  };
  assert.deepEqual(await fulfillRequest(ctx, request, catalog), receipt);
  assert.deepEqual(calls, [
    { name: "findEmoji", args: [catalog, request] },
    { name: "deliverReply", args: [{
      requestId: "Ev123", teamId: "T123", channelId: "D123", threadTs: "123.001", text: ":panic:",
    }] },
  ]);
});

test("generation failure never starts delivery", async (t) => {
  configureWorkspace(t);
  const names: string[] = [];
  const ctx: TaskContext = {
    run: async (task, ..._args) => { names.push(task.name); throw new Error("Generation failed"); },
  };
  await assert.rejects(fulfillRequest(ctx, request, catalog), /Generation failed/);
  assert.deepEqual(names, ["findEmoji"]);
});

test("invalid destinations fail before any task is dispatched", async (t) => {
  configureWorkspace(t);
  let dispatched = false;
  const ctx: TaskContext = { run: async () => { dispatched = true; throw new Error("Must not dispatch"); } };
  await assert.rejects(fulfillRequest(ctx, { ...request, teamId: "TOTHER" }, catalog), /workspace/);
  await assert.rejects(fulfillRequest(ctx, { ...request, channelId: "C123" }, catalog), /direct messages/);
  await assert.rejects(fulfillRequest(ctx, { ...request, messageTs: "bad" }, catalog), /timestamp/);
  await assert.rejects(fulfillRequest(ctx, { ...request, messageTs: "122.001" }, catalog), /timestamp/);
  assert.equal(dispatched, false);
});


test("generation loads the Slack conversation before calling Anthropic", async (t) => {
  configureWorkspace(t);
  for (const [name, value] of Object.entries({
    SLACK_BOT_TOKEN: "test-token", EMOJI_FINDER_API_KEY: "test-key", EMOJI_FINDER_MODEL: "test-model",
  })) {
    const previous = process.env[name];
    process.env[name] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    });
  }
  const slackCalls: string[] = [];
  t.mock.method(WebClient.prototype, "apiCall", async (method: string, options?: Parameters<WebClient["apiCall"]>[1]) => {
    slackCalls.push(method);
    if (method === "auth.test") return { ok: true, team_id: "T123", user_id: "UBOT", bot_id: "B123" };
    assert.equal(method, "conversations.replies");
    assert.equal(options?.ts, request.threadTs);
    assert.equal(options?.latest, "123.003");
    return { ok: true, messages: [
      { ts: "123.001", user: "UPERSON", text: "panic" },
      { ts: "123.002", user: "UBOT", text: ":panic:" },
    ] };
  });
  t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    assert.deepEqual(JSON.parse(init!.body as string).messages, [
      { role: "user", content: "panic" },
      { role: "assistant", content: ":panic:" },
      { role: "user", content: "more subtle" },
    ]);
    return Response.json({
      id: "msg_test", type: "message", role: "assistant", model: "test-model", stop_reason: "tool_use",
      content: [{ type: "tool_use", id: "tool_test", name: "suggest_emoji", input: { picks: [{ name: "panic" }] } }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });
  });
  t.mock.method(console, "log", () => {});
  const ctx: TaskContext = { run: async () => { throw new Error("Must not dispatch a child task"); } };
  assert.equal(await generate.func(ctx, catalog, {
    ...request, messageTs: "123.003", query: "more subtle",
  }), ":panic:");
  assert.deepEqual(slackCalls, ["auth.test", "conversations.replies"]);
});
