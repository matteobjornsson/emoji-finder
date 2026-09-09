export interface EmojiRequest {
  requestId: string;
  teamId: string;
  channelId: string;
  threadTs: string;
  messageTs: string;
  query: string;
}

export interface Reply {
  requestId: string;
  teamId: string;
  channelId: string;
  threadTs: string;
  text: string;
}

export interface Receipt {
  requestId: string;
  channelId: string;
  messageTs: string;
}

export function parseRequest(value: unknown): EmojiRequest {
  if (!value || typeof value !== "object") throw new Error("Invalid request");
  const request = value as Record<string, unknown>;
  for (const key of ["requestId", "teamId", "channelId", "threadTs", "messageTs", "query"]) {
    if (typeof request[key] !== "string" || !request[key]) {
      throw new Error(`Missing request field: ${key}`);
    }
  }
  if (!/^D[A-Z0-9]+$/.test(request.channelId as string)) {
    throw new Error("Only direct messages are supported");
  }
  if (!/^\d+\.\d+$/.test(request.threadTs as string)) {
    throw new Error("Invalid thread timestamp");
  }
  if (!/^\d+\.\d+$/.test(request.messageTs as string) ||
      Number(request.messageTs) < Number(request.threadTs)) {
    throw new Error("Invalid message timestamp");
  }
  return {
    requestId: request.requestId as string,
    teamId: request.teamId as string,
    channelId: request.channelId as string,
    threadTs: request.threadTs as string,
    messageTs: request.messageTs as string,
    query: (request.query as string).trim(),
  };
}
