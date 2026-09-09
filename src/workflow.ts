import { task, type TaskContext } from "@renderinc/sdk/workflows";
import { Catalog, type CatalogEntry } from "./catalog.js";
import { finderConfig, required } from "./config.js";
import { loadConversation } from "./conversation.js";
import { deliverReply } from "./delivery.js";
import { findEmoji } from "./finder.js";
import { parseRequest, type EmojiRequest, type Reply, type Receipt } from "./request.js";
import { slackClient, verifyWorkspace } from "./slack.js";

const retry = { maxRetries: 3, waitDurationMs: 2000, backoffScaling: 2 };

export const generate = task(
  { name: "findEmoji", retry },
  async (_ctx: TaskContext, entries: readonly CatalogEntry[], request: EmojiRequest): Promise<string> => {
    const client = slackClient();
    const { botUserId } = await verifyWorkspace(client, request.teamId);
    const messages = await loadConversation(client.conversations.replies, request, botUserId);
    return findEmoji(new Catalog(entries), messages, finderConfig());
  },
);

export const deliver = task(
  { name: "deliverReply", retry: { ...retry, waitDurationMs: 5000 } },
  async (_ctx: TaskContext, reply: Reply): Promise<Receipt> => {
    const client = slackClient();
    const { botUserId } = await verifyWorkspace(client, reply.teamId);
    return deliverReply({
      replies: client.conversations.replies,
      postMessage: client.chat.postMessage,
    }, reply, botUserId);
  },
);

export async function fulfillRequest(
  ctx: TaskContext, input: unknown, catalog: readonly CatalogEntry[],
): Promise<Receipt> {
  const request = parseRequest(input);
  if (request.teamId !== required("SLACK_TEAM_ID")) throw new Error("Unexpected workspace");
  const text = await ctx.run(generate, catalog, request);
  return ctx.run(deliver, {
    requestId: request.requestId,
    teamId: request.teamId,
    channelId: request.channelId,
    threadTs: request.threadTs,
    text,
  });
}

// Child tasks own retries; replaying this parent would generate a new answer.
task({ name: "fulfillRequest", retry: { maxRetries: 0, waitDurationMs: 1000 } }, fulfillRequest);
