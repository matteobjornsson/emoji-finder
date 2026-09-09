import type Anthropic from "@anthropic-ai/sdk";
import assert from "node:assert/strict";
import { test } from "node:test";
import { Catalog } from "../src/catalog.js";
import type { FinderConfig } from "../src/config.js";
import { findEmoji } from "../src/finder.js";

const config: FinderConfig = { apiKey: "test-key", model: "test-model" };
const catalog = Catalog.fromSlack({ panic: "panic.png", alarm: "alias:panic", joy: "joy.png" });

test("model tool results become ranked, validated Slack emoji", async (t) => {
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: "quietly panicking" },
    { role: "assistant", content: ":panic: :joy:" },
    { role: "user", content: "more like the second one" },
  ];
  const request = t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(init!.body as string);
    assert.equal(body.model, "test-model");
    assert.deepEqual(body.messages, messages);
    assert.equal(body.tool_choice.name, "suggest_emoji");
    return Response.json({
      id: "msg_test", type: "message", role: "assistant", model: "test-model", stop_reason: "tool_use",
      content: [{ type: "tool_use", id: "tool_test", name: "suggest_emoji", input: {
        picks: [{ name: "invented" }, { name: "joy" }, { name: "alarm" }, { name: "panic" }],
      } }], usage: { input_tokens: 10, output_tokens: 5 },
    });
  });
  t.mock.method(console, "log", () => {});
  assert.equal(await findEmoji(catalog, messages, config), ":joy: :alarm:");
  assert.equal(request.mock.callCount(), 1);
});

test("model API failures propagate after one attempt so Workflows owns retry", async (t) => {
  const request = t.mock.method(globalThis, "fetch", async () =>
    Response.json({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }, { status: 529 }));
  await assert.rejects(findEmoji(catalog, [{ role: "user", content: "panic" }], config), /529/);
  assert.equal(request.mock.callCount(), 1);
});

test("truncated model output fails instead of sending partial suggestions", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({
    id: "msg_test", type: "message", role: "assistant", model: "test-model",
    stop_reason: "max_tokens", content: [], usage: { input_tokens: 10, output_tokens: 5 },
  }));
  await assert.rejects(findEmoji(catalog, [{ role: "user", content: "panic" }], config), /truncated/);
});


test("model-selected counts are preserved for both twenty results and a single best match", async (t) => {
  const names = Array.from({ length: 20 }, (_, i) => `pick_${i}`);
  const largeCatalog = Catalog.fromSlack(Object.fromEntries(names.map((name) => [name, `${name}.png`])));
  let selected = names;
  t.mock.method(globalThis, "fetch", async () => Response.json({
    id: "msg_test", type: "message", role: "assistant", model: "test-model", stop_reason: "tool_use",
    content: [{ type: "tool_use", id: "tool_test", name: "suggest_emoji", input: {
      picks: [...selected.map((name) => ({ name })), { name: "invented" }, { name: selected[0] }],
    } }], usage: { input_tokens: 10, output_tokens: 100 },
  }));
  t.mock.method(console, "log", () => {});
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: "give me 20" }];
  const reply = await findEmoji(largeCatalog, messages, config);
  assert.equal(reply, names.map((name) => `:${name}:`).join(" "));
  messages.push({ role: "assistant", content: reply }, { role: "user", content: "the best one" });
  selected = [names[0]!];
  assert.equal(await findEmoji(largeCatalog, messages, config), ":pick_0:");
});
