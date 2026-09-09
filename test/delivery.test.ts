import assert from "node:assert/strict";
import { test } from "node:test";
import { deliverReply, replyEventType, type DeliveryClient } from "../src/delivery.js";
import type { Reply } from "../src/request.js";

const reply: Reply = {
  requestId: "Ev123", teamId: "T123", channelId: "D123", threadTs: "123.001", text: ":bufo:",
};
const posted = {
  user: "U123", ts: "123.002",
  metadata: { event_type: replyEventType, event_payload: { request_id: reply.requestId } },
};

test("delivery retry recovers a successful Slack post whose response was lost", async () => {
  let visible = false;
  let sends = 0;
  const client: DeliveryClient = {
    replies: async () => ({ ok: true, messages: visible ? [posted] : [] }),
    postMessage: async (args) => {
      sends++;
      assert.deepEqual(args.metadata, posted.metadata);
      assert.equal(args.thread_ts, reply.threadTs);
      visible = true;
      throw new Error("Connection lost after Slack accepted the message");
    },
  };
  await assert.rejects(deliverReply(client, reply, "U123"));
  assert.deepEqual(await deliverReply(client, reply, "U123"), {
    requestId: reply.requestId, channelId: reply.channelId, messageTs: posted.ts,
  });
  assert.equal(sends, 1);
});

test("lookup errors never authorize a new send", async () => {
  let sends = 0;
  const client: DeliveryClient = {
    replies: async () => { throw new Error("Slack unavailable"); },
    postMessage: async () => { sends++; return { ok: true, ts: "123.002" }; },
  };
  await assert.rejects(deliverReply(client, reply, "U123"));
  assert.equal(sends, 0);
});

test("delivery searches all pages and only trusts messages by this bot", async () => {
  const cursors: (string | undefined)[] = [];
  const client: DeliveryClient = {
    replies: async (args) => {
      cursors.push(args.cursor);
      assert.equal(args.include_all_metadata, true);
      if (!args.cursor) return {
        ok: true, messages: [{ ...posted, user: "UOTHER" }], has_more: true,
        response_metadata: { next_cursor: "page2" },
      };
      return { ok: true, messages: [posted] };
    },
    postMessage: async () => { throw new Error("Must not post"); },
  };
  assert.equal((await deliverReply(client, reply, "U123")).messageTs, posted.ts);
  assert.deepEqual(cursors, [undefined, "page2"]);
});

test("a distinct request gets its own reply even when the text matches", async () => {
  let sends = 0;
  const client: DeliveryClient = {
    replies: async () => ({ ok: true, messages: [posted] }),
    postMessage: async () => { sends++; return { ok: true, ts: "123.003" }; },
  };
  const result = await deliverReply(client, { ...reply, requestId: "Ev456" }, "U123");
  assert.equal(result.messageTs, "123.003");
  assert.equal(sends, 1);
});

test("an incomplete history response fails rather than assuming absence", async () => {
  const client: DeliveryClient = {
    replies: async () => ({ ok: true, messages: [], has_more: true }),
    postMessage: async () => { throw new Error("Must not post"); },
  };
  await assert.rejects(deliverReply(client, reply, "U123"), /pagination/);
});
