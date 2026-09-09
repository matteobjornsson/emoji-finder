import type { WebClient } from "@slack/web-api";
import type { Receipt, Reply } from "./request.js";

export const replyEventType = "emoji_finder.reply";

export interface DeliveryClient {
  replies: WebClient["conversations"]["replies"];
  postMessage: WebClient["chat"]["postMessage"];
}

export async function existingReply(
  client: DeliveryClient,
  reply: Reply,
  botUserId: string,
): Promise<Receipt | undefined> {
  let cursor: string | undefined;
  do {
    const page = await client.replies({
      channel: reply.channelId,
      ts: reply.threadTs,
      include_all_metadata: true,
      limit: 100,
      ...(cursor ? { cursor } : {}),
    });
    if (!page.ok || !page.messages) throw new Error("Could not verify Slack delivery");
    const message = page.messages.find((message) =>
      message.user === botUserId &&
      message.metadata?.event_type === replyEventType &&
      "request_id" in (message.metadata.event_payload ?? {}) &&
      (message.metadata.event_payload as { request_id: unknown }).request_id === reply.requestId);
    if (message?.ts) {
      return { requestId: reply.requestId, channelId: reply.channelId, messageTs: message.ts };
    }
    cursor = page.response_metadata?.next_cursor || undefined;
    if (page.has_more && !cursor) throw new Error("Incomplete Slack thread pagination");
  } while (cursor);
  return undefined;
}

export async function deliverReply(
  client: DeliveryClient,
  reply: Reply,
  botUserId: string,
): Promise<Receipt> {
  // A previous attempt may have posted successfully before losing its response.
  const existing = await existingReply(client, reply, botUserId);
  if (existing) return existing;
  const posted = await client.postMessage({
    channel: reply.channelId,
    thread_ts: reply.threadTs,
    text: reply.text,
    metadata: {
      event_type: replyEventType,
      event_payload: { request_id: reply.requestId },
    },
    unfurl_links: false,
    unfurl_media: false,
  });
  if (!posted.ok || !posted.ts) throw new Error("Slack did not confirm delivery");
  return { requestId: reply.requestId, channelId: reply.channelId, messageTs: posted.ts };
}
