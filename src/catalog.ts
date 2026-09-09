import type { WebClient } from "@slack/web-api";

const emojiName = /^[a-zA-Z0-9_+\-]+$/;

export interface CatalogEntry {
  name: string;
  canonicalName: string;
}

export async function loadCatalog(listEmoji: WebClient["emoji"]["list"]): Promise<Catalog> {
  const response = await listEmoji();
  if (!response.ok || !response.emoji) throw new Error("Could not load workspace emoji");
  return Catalog.fromSlack(response.emoji);
}

export class Catalog {
  readonly entries: readonly CatalogEntry[];
  readonly names: readonly string[];
  private readonly canonical = new Map<string, string>();

  constructor(entries: readonly CatalogEntry[]) {
    if (!Array.isArray(entries) || entries.some((entry) =>
      !entry || typeof entry.name !== "string" || typeof entry.canonicalName !== "string" ||
      !emojiName.test(entry.name) || !emojiName.test(entry.canonicalName))) {
      throw new Error("Invalid catalog snapshot");
    }
    this.entries = Object.freeze(entries.map((entry) => Object.freeze({ ...entry }))
      .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of this.entries) this.canonical.set(entry.name, entry.canonicalName);
    this.names = Object.freeze([...this.canonical.keys()]);
  }

  static fromSlack(emoji: Record<string, string>): Catalog {
    const entries: CatalogEntry[] = [];
    for (const name of Object.keys(emoji).sort()) {
      if (!emojiName.test(name)) continue;
      const visited = new Set<string>();
      let target = name;
      while (!visited.has(target)) {
        visited.add(target);
        const value = Object.hasOwn(emoji, target) ? emoji[target] : undefined;
        if (!value?.startsWith("alias:")) {
          entries.push({ name, canonicalName: target });
          break;
        }
        target = value.slice("alias:".length);
        if (!emojiName.test(target)) break;
      }
    }
    return new Catalog(entries);
  }

  get block(): string {
    return this.names.join("\n");
  }

  validate(input: unknown): string[] {
    if (!input || typeof input !== "object" ||
        !Array.isArray((input as { picks?: unknown }).picks)) {
      throw new Error("Model returned an invalid emoji selection");
    }
    const seen = new Set<string>();
    const names: string[] = [];
    for (const pick of (input as { picks: unknown[] }).picks) {
      if (!pick || typeof pick !== "object") continue;
      const name = (pick as { name?: unknown }).name;
      if (typeof name !== "string") continue;
      const canonical = this.canonical.get(name);
      if (!canonical || seen.has(canonical)) continue;
      seen.add(canonical);
      names.push(name);
    }
    return names;
  }
}
