import type Anthropic from "@anthropic-ai/sdk";
import type { WebClient } from "@slack/web-api";
import type { EmojiRequest } from "./request.js";

export function decodeMessageText(text: string): string {
  return text.trim().replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

export async function loadConversation(
  replies: WebClient["conversations"]["replies"],
  request: EmojiRequest,
  botUserId: string,
): Promise<Anthropic.MessageParam[]> {
  const latest: Anthropic.MessageParam = { role: "user", content: request.query };
  if (request.messageTs === request.threadTs) return [latest];

  const history = new Map<string, Anthropic.MessageParam>();
  let cursor: string | undefined;
  do {
    const page = await replies({
      channel: request.channelId,
      ts: request.threadTs,
      latest: request.messageTs,
      inclusive: true,
      limit: 100,
      ...(cursor ? { cursor } : {}),
    });
    if (!page.ok || !page.messages) throw new Error("Could not load Slack conversation");
    for (const message of page.messages) {
      if (!message.ts || Number(message.ts) >= Number(request.messageTs) ||
          (message.thread_ts && message.thread_ts !== request.threadTs) ||
          !message.text?.trim()) continue;
      const subtype = "subtype" in message ? message.subtype : undefined;
      if (message.user === botUserId && (!subtype || subtype === "bot_message")) {
        history.set(message.ts, { role: "assistant", content: decodeMessageText(message.text) });
      } else if (message.user && !message.bot_id && !subtype) {
        history.set(message.ts, { role: "user", content: decodeMessageText(message.text) });
      }
    }
    cursor = page.response_metadata?.next_cursor || undefined;
    if (page.has_more && !cursor) throw new Error("Incomplete Slack conversation pagination");
  } while (cursor);

  if (history.get(request.threadTs)?.role !== "user") {
    throw new Error("Slack conversation is missing its original request");
  }
  // The event supplies the triggering text even if Slack history has not caught up.
  return [...history.entries()]
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, message]) => message)
    .concat(latest);
}
