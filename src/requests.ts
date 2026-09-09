import type { EmojiRequest } from "./request.js";

interface Submission {
  accepted: Promise<void>;
  expiresAt: number;
}

export class Requests {
  private readonly recent = new Map<string, Submission>();

  constructor(
    private readonly submit: (request: EmojiRequest) => Promise<void>,
    private readonly now: () => number = Date.now,
  ) {}

  async accept(request: EmojiRequest): Promise<void> {
    for (const [id, entry] of this.recent) {
      if (entry.expiresAt <= this.now()) this.recent.delete(id);
    }
    const existing = this.recent.get(request.requestId);
    if (existing) {
      await existing.accepted;
      return;
    }
    if (this.recent.size >= 10_000) {
      const oldest = [...this.recent].find(([, entry]) => Number.isFinite(entry.expiresAt));
      if (!oldest) throw new Error("Too many pending submissions");
      this.recent.delete(oldest[0]);
    }

    // Concurrent redeliveries share submission; retention starts after acceptance.
    const entry = { accepted: Promise.resolve().then(() => this.submit(request)), expiresAt: Infinity };
    this.recent.set(request.requestId, entry);
    try {
      await entry.accepted;
      entry.expiresAt = this.now() + 10 * 60_000;
    } catch (error) {
      this.recent.delete(request.requestId);
      throw error;
    }
  }
}
