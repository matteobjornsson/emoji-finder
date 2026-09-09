import { App, HTTPReceiver } from "@slack/bolt";
import { decodeMessageText } from "./conversation.js";
import type { EmojiRequest } from "./request.js";

export interface AppConfig {
  signingSecret: string;
  teamId: string;
  botToken: string;
  botId: string;
  botUserId: string;
}

export function createApp(
  config: AppConfig,
  accept: (request: EmojiRequest) => Promise<void>,
) {
  const receiver = new HTTPReceiver({
    signingSecret: config.signingSecret,
    processBeforeResponse: true,
    customRoutes: [{
      path: "/healthz",
      method: ["GET"],
      handler: (_req, res) => { res.writeHead(200).end("ok\n"); },
    }],
    processEventErrorHandler: async ({ response }) => {
      if (!response.headersSent) response.writeHead(503).end("Could not accept request");
      return true;
    },
  });
  const app = new App({
    receiver,
    authorize: async ({ teamId }) => {
      if (teamId !== config.teamId) throw new Error("Unexpected workspace");
      return {
        teamId,
        botToken: config.botToken,
        botId: config.botId,
        botUserId: config.botUserId,
      };
    },
  });
  app.message(async ({ message, body }) => {
    if (message.channel_type !== "im" || message.subtype ||
        "bot_id" in message || message.user === config.botUserId ||
        !message.text?.trim()) return;
    const requestId = body.event_id;
    if (typeof requestId !== "string" || !requestId) throw new Error("Missing Slack event ID");
    await accept({
      requestId,
      teamId: config.teamId,
      channelId: message.channel,
      threadTs: message.thread_ts ?? message.ts,
      messageTs: message.ts,
      query: decodeMessageText(message.text),
    });
  });
  // Propagate dispatch failures so Slack gets a retryable HTTP response.
  app.error(async (error) => { throw error; });
  return { app, receiver };
}
