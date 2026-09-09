import assert from "node:assert/strict";
import { test } from "node:test";
import { Requests } from "../src/requests.js";
import type { EmojiRequest } from "../src/request.js";

const request: EmojiRequest = {
  requestId: "Ev123", teamId: "T123", channelId: "D123", threadTs: "123.001", messageTs: "123.001", query: "panic",
};

test("duplicate events share a pending submission and accepted events are remembered", async () => {
  let count = 0;
  const gate = Promise.withResolvers<string>();
  const requests = new Requests(() => { count++; return gate.promise; });
  const first = requests.accept(request);
  const duplicate = requests.accept(request);
  await Promise.resolve();
  assert.equal(count, 1);
  gate.resolve("run123");
  await Promise.all([first, duplicate]);
  await requests.accept(request);
  assert.equal(count, 1);
});

test("failed submission is retryable on the next Slack delivery", async () => {
  let count = 0;
  const requests = new Requests(async () => {
    if (++count === 1) throw new Error("Render unavailable");
    return "run123";
  });
  await assert.rejects(requests.accept(request), /Render unavailable/);
  await requests.accept(request);
  assert.equal(count, 2);
});

test("event retention expires without consulting or canceling a workflow", async () => {
  let now = 0;
  let count = 0;
  const requests = new Requests(async () => { count++; return "run123"; }, () => now);
  await requests.accept(request);
  now = 599_999;
  await requests.accept(request);
  assert.equal(count, 1);
  now = 600_000;
  await requests.accept(request);
  assert.equal(count, 2);
});
