import test from "node:test";
import assert from "node:assert/strict";
import { findCircularOrder, normalizeName, validateExchangeInput } from "../src/engine.js";

test("creates one circular order containing every participant exactly once", () => {
  const names = ["Ada Lovelace", "Grace Hopper", "Alan Turing", "Katherine Johnson"];
  const order = findCircularOrder(names, [], () => 0.42);

  assert.equal(order.length, names.length);
  assert.deepEqual(new Set(order), new Set(names));
  order.forEach((giver, index) => assert.notEqual(giver, order[(index + 1) % order.length]));
});

test("honors directed giver-to-recipient exclusions", () => {
  const names = ["A One", "B Two", "C Three", "D Four"];
  const exclusions = [
    { giver: "A One", recipient: "B Two" },
    { giver: "C Three", recipient: "A One" },
  ];
  const order = findCircularOrder(names, exclusions, () => 0.31);

  assert.ok(order);
  const pairs = order.map((giver, index) => `${giver}>${order[(index + 1) % order.length]}`);
  assert.ok(!pairs.includes("A One>B Two"));
  assert.ok(!pairs.includes("C Three>A One"));
});

test("reports impossible constraints", () => {
  const names = ["A One", "B Two", "C Three"];
  const exclusions = [
    { giver: "A One", recipient: "B Two" },
    { giver: "A One", recipient: "C Three" },
  ];
  assert.equal(findCircularOrder(names, exclusions, () => 0.5), null);
});

test("normalizes full names and rejects duplicates", () => {
  assert.equal(normalizeName("  Ada   LOVELACE "), "ada lovelace");
  assert.throws(
    () => validateExchangeInput(["Ada Lovelace", " ada  lovelace "], []),
    /unique full name/,
  );
});

test("ignores self-exclusions because self-draws are always prohibited", () => {
  const result = validateExchangeInput(
    ["A One", "B Two"],
    [{ giver: "A One", recipient: "A One" }],
  );
  assert.deepEqual(result.exclusions, []);
});
