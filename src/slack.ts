import { WebClient } from "@slack/web-api";
import { required } from "./config.js";

export function slackClient(): WebClient {
  return new WebClient(required("SLACK_BOT_TOKEN"), {
    retryConfig: { retries: 0 },
    rejectRateLimitedCalls: true,
    timeout: 10_000,
  });
}

export async function verifyWorkspace(client: WebClient, teamId: string) {
  if (teamId !== required("SLACK_TEAM_ID")) throw new Error("Unexpected workspace");
  const auth = await client.auth.test();
  if (!auth.ok || auth.team_id !== teamId || !auth.user_id || !auth.bot_id) {
    throw new Error("Slack token does not belong to the configured workspace");
  }
  return { botUserId: auth.user_id, botId: auth.bot_id };
}
