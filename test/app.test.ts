import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { setTimeout } from "node:timers/promises";
import { test, type TestContext } from "node:test";
import { createApp } from "../src/app.js";
import type { EmojiRequest } from "../src/request.js";

const config = {
  signingSecret: "test-signing-secret", teamId: "T123", botToken: "xoxb-test",
  botId: "B123", botUserId: "UBOT",
};

function event(message: Record<string, unknown> = {}) {
  return {
    type: "event_callback", team_id: config.teamId, api_app_id: "A123", event_id: "Ev123",
    authorizations: [{ team_id: config.teamId, user_id: config.botUserId, is_bot: true }],
    event: {
      type: "message", channel_type: "im", channel: "D123", user: "UPERSON",
      ts: "123.001", text: "panic &amp; joy", ...message,
    },
  };
}

async function serve(t: TestContext, accept: (request: EmojiRequest) => Promise<void>) {
  const { receiver } = createApp(config, accept);
  const server = createServer(receiver.requestListener);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise<void>((resolve, reject) => {
    server.closeAllConnections();
    server.close((error) => error ? reject(error) : resolve());
  }));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}`;
  return {
    url,
    post: (body: unknown, secret = config.signingSecret, timestamp = Math.floor(Date.now() / 1000)) => {
      const payload = JSON.stringify(body);
      const signature = createHmac("sha256", secret).update(`v0:${timestamp}:${payload}`).digest("hex");
      return fetch(`${url}/slack/events`, {
        method: "POST", body: payload, signal: AbortSignal.timeout(2000),
        headers: {
          "content-type": "application/json", "x-slack-request-timestamp": String(timestamp),
          "x-slack-signature": `v0=${signature}`,
        },
      });
    },
  };
}

test("Slack is acknowledged after submission acceptance and the request retains its thread", async (t) => {
  const accepted = Promise.withResolvers<void>();
  const received = Promise.withResolvers<EmojiRequest>();
  t.after(() => accepted.resolve());
  const server = await serve(t, async (request) => {
    received.resolve(request);
    await accepted.promise;
  });
  const response = server.post(event({ thread_ts: "122.001" }));
  assert.deepEqual(await received.promise, {
    requestId: "Ev123", teamId: "T123", channelId: "D123", threadTs: "122.001", messageTs: "123.001", query: "panic & joy",
  });
  assert.equal(await Promise.race([
    response.then(() => "acknowledged"), setTimeout(30, "waiting"),
  ]), "waiting");
  accepted.resolve();
  assert.equal((await response).status, 200);
});

test("submission failure returns a retryable response to Slack", async (t) => {
  const server = await serve(t, async () => { throw new Error("Render unavailable"); });
  assert.equal((await server.post(event())).status, 503);
});

test("invalid signatures and stale requests cannot submit workflows", async (t) => {
  let submissions = 0;
  const server = await serve(t, async () => { submissions++; });
  assert.equal((await server.post(event(), "wrong-secret")).status, 401);
  assert.equal((await server.post(event(), config.signingSecret, 1)).status, 401);
  assert.equal(submissions, 0);
});

test("bot messages, edits, channel messages, and empty messages are ignored", async (t) => {
  let submissions = 0;
  const server = await serve(t, async () => { submissions++; });
  for (const message of [
    { user: config.botUserId }, { bot_id: "BOTHER" }, { subtype: "bot_message" },
    { subtype: "message_changed" }, { channel_type: "channel", channel: "C123" }, { text: " " },
  ]) {
    assert.equal((await server.post(event(message))).status, 200);
  }
  assert.equal(submissions, 0);
});

test("events from another workspace cannot submit workflows", async (t) => {
  let submissions = 0;
  const server = await serve(t, async () => { submissions++; });
  const body = event();
  body.team_id = "TOTHER";
  body.authorizations[0]!.team_id = "TOTHER";
  assert.equal((await server.post(body)).status, 503);
  assert.equal(submissions, 0);
});

test("Slack URL verification and health checks do not dispatch workflows", async (t) => {
  const server = await serve(t, async () => { throw new Error("Must not dispatch"); });
  const response = await server.post({ type: "url_verification", challenge: "challenge123" });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { challenge: "challenge123" });
  assert.equal((await fetch(`${server.url}/healthz`)).status, 200);
});


test("each top-level DM uses its own timestamp as the thread root", async (t) => {
  const requests: EmojiRequest[] = [];
  const server = await serve(t, async (request) => { requests.push(request); });
  assert.equal((await server.post(event())).status, 200);
  const next = event({ ts: "124.001" });
  next.event_id = "Ev124";
  assert.equal((await server.post(next)).status, 200);
  assert.deepEqual(requests.map(({ threadTs, messageTs }) => ({ threadTs, messageTs })), [
    { threadTs: "123.001", messageTs: "123.001" },
    { threadTs: "124.001", messageTs: "124.001" },
  ]);
});
