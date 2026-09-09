import assert from "node:assert/strict";
import { test } from "node:test";
import { Catalog, loadCatalog } from "../src/catalog.js";
import { buildPrompt } from "../src/finder.js";
import type { FinderConfig } from "../src/config.js";

test("catalog validates exact names, relevance order, and aliases", () => {
  const catalog = Catalog.fromSlack({
    bufo: "https://example.com/bufo.png", frog: "alias:bufo",
    happier: "alias:happy", happy: "alias:smile", panic: "https://example.com/panic.gif",
    cycle_a: "alias:cycle_b", cycle_b: "alias:cycle_a", "<@everyone>": "invalid.png",
  });
  const input = { picks: [
    { name: "invented" }, { name: "panic" }, { name: "frog" },
    { name: "bufo" }, { name: "happier" }, { name: "happy" },
    { name: "cycle_a" }, { name: "<@everyone>" }, { name: 42 },
  ] };
  assert.deepEqual(catalog.validate(input), ["panic", "frog", "happier"]);
  assert.throws(() => catalog.validate({ picks: "panic" }));
});

test("prompt cache prefix stays identical across queries and API ordering", () => {
  const config: FinderConfig = { apiKey: "unused", model: "test" };
  const first = buildPrompt(Catalog.fromSlack({ b: "b.png", a: "a.png" }), [{ role: "user", content: "first query" }], config);
  const second = buildPrompt(Catalog.fromSlack({ a: "a.png", b: "b.png" }), [{ role: "user", content: "first query" }, { role: "assistant", content: ":a:" }, { role: "user", content: "another query" }], config);
  assert.deepEqual(first.system, second.system);
  assert.deepEqual(first.tools, second.tools);
  assert.notDeepEqual(first.messages, second.messages);
  assert.equal(first.system[0]?.cache_control?.ttl, "5m");
});

test("a loaded snapshot survives serialization and stays stable across catalog updates", async () => {
  let emoji = { frog: "frog.png", bufo: "alias:frog" };
  let loads = 0;
  const listEmoji = async () => { loads++; return { ok: true, emoji }; };
  const original = await loadCatalog(listEmoji);
  const inFlight = new Catalog(JSON.parse(JSON.stringify(original.entries)));
  emoji = { frog: "new-frog.png", bufo: "new-bufo.png" };
  const updated = await loadCatalog(listEmoji);
  const picks = { picks: [{ name: "frog" }, { name: "bufo" }] };
  assert.deepEqual(original.validate(picks), ["frog"]);
  assert.deepEqual(inFlight.validate(picks), ["frog"]);
  assert.deepEqual(updated.validate(picks), ["frog", "bufo"]);
  assert.equal(loads, 2);
  assert.equal(JSON.stringify(original.entries).includes(".png"), false);
});

test("catalog load failure does not produce an empty snapshot", async () => {
  await assert.rejects(loadCatalog(async () => ({ ok: false })), /load workspace emoji/);
});
