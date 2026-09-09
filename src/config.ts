export function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Set ${name}`);
  if (value.startsWith("op://")) {
    throw new Error(`${name} is an unresolved 1Password reference; launch with op run`);
  }
  return value;
}

export interface FinderConfig {
  apiKey: string;
  model: string;
}

export function finderConfig(): FinderConfig {
  return {
    apiKey: required("EMOJI_FINDER_API_KEY"),
    model: required("EMOJI_FINDER_MODEL"),
  };
}
