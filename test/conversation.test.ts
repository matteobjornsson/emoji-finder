import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConversation } from "../src/conversation.js";
import type { EmojiRequest } from "../src/request.js";

const request: EmojiRequest = {
  requestId: "Ev123", teamId: "T123", channelId: "D123",
  threadTs: "123.001", messageTs: "123.004", query: "more sarcastic",
};
const root = { ts: "123.001", user: "UPERSON", text: "panic &amp; joy" };
const suggestion = { ts: "123.002", user: "UBOT", bot_id: "B123", subtype: "bot_message", text: ":panic: :joy:" };

test("a top-level DM starts a new conversation without reading other DMs", async () => {
  const messages = await loadConversation(async () => { throw new Error("Must not read history"); }, {
    ...request, messageTs: request.threadTs,
  }, "UBOT");
  assert.deepEqual(messages, [{ role: "user", content: request.query }]);
});

test("history retains roles and order, excludes later messages, and uses triggering event text once", async () => {
  const messages = await loadConversation(async (args) => {
    assert.equal(args.channel, request.channelId);
    assert.equal(args.ts, request.threadTs);
    assert.equal(args.latest, request.messageTs);
    assert.equal(args.inclusive, true);
    return { ok: true, messages: [
      suggestion, root,
      { ts: "123.003", user: "UPERSON", text: "keep &lt;the vibe&gt;" },
      { ts: request.messageTs, user: "UPERSON", text: "edited after event" },
      { ts: "123.005", user: "UBOT", text: ":later:" },
      { ts: "123.006", user: "UPERSON", text: "later request" },
      { ts: "123.0021", user: "UOTHERBOT", bot_id: "BOTHER", text: "ignore" },
      { ts: "123.0022", user: "UPERSON", subtype: "message_deleted", text: "ignore" },
      { ts: "123.0023", user: "UPERSON", thread_ts: "122.001", text: "other thread" },
    ] };
  }, request, "UBOT");
  assert.deepEqual(messages, [
    { role: "user", content: "panic & joy" },
    { role: "assistant", content: ":panic: :joy:" },
    { role: "user", content: "keep <the vibe>" },
    { role: "user", content: "more sarcastic" },
  ]);
});

test("pagination retains the root and more than thirty exchanges without truncation", async () => {
  const history = [root, ...Array.from({ length: 64 }, (_, i) => ({
    ts: `123.${String(i + 2).padStart(3, "0")}`,
    user: i % 2 ? "UPERSON" : "UBOT",
    text: i % 2 ? `refinement ${i}` : `:pick_${i}:`,
  }))];
  let calls = 0;
  const messages = await loadConversation(async (args) => {
    calls++;
    if (!args.cursor) return {
      ok: true, messages: history.slice(0, 30), has_more: true,
      response_metadata: { next_cursor: "page2" },
    };
    assert.equal(args.cursor, "page2");
    return { ok: true, messages: history.slice(29), has_more: false };
  }, { ...request, messageTs: "123.100" }, "UBOT");
  assert.equal(calls, 2);
  assert.equal(messages.length, 66);
  assert.equal(messages[0]?.content, "panic & joy");
  assert.equal(messages[64]?.content, "refinement 63");
  assert.equal(messages[65]?.content, request.query);
});

test("the triggering event is included when it is not visible in history yet", async () => {
  const messages = await loadConversation(async () => ({ ok: true, messages: [root, suggestion] }), request, "UBOT");
  assert.deepEqual(messages.at(-1), { role: "user", content: request.query });
  assert.equal(messages.length, 3);
});

test("failed, incomplete, or rootless history fails rather than discarding context", async () => {
  await assert.rejects(loadConversation(async () => { throw new Error("Slack unavailable"); }, request, "UBOT"), /unavailable/);
  await assert.rejects(loadConversation(async () => ({ ok: false }), request, "UBOT"), /load Slack conversation/);
  await assert.rejects(loadConversation(async () => ({ ok: true, messages: [root], has_more: true }), request, "UBOT"), /pagination/);
  await assert.rejects(loadConversation(async () => ({ ok: true, messages: [suggestion] }), request, "UBOT"), /original request/);
});
