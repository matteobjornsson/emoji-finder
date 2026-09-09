import assert from "node:assert/strict";
import { test } from "node:test";
import { required } from "../src/config.js";

test("configuration rejects missing settings and unresolved references without exposing values", (t) => {
  const name = "EMOJI_FINDER_TEST_SETTING";
  const previous = process.env[name];
  t.after(() => {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  });
  delete process.env[name];
  assert.throws(() => required(name), { message: `Set ${name}` });
  process.env[name] = "op://private-vault/private-item/credential";
  assert.throws(() => required(name), {
    message: `${name} is an unresolved 1Password reference; launch with op run`,
  });
  process.env[name] = "  test-resolved-value  ";
  assert.equal(required(name), "test-resolved-value");
});
