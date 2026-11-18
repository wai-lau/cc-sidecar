// creditsText mirrors the terminal status line's credits wording.
import { test } from "node:test";
import assert from "node:assert/strict";
import { creditsText } from "./usage.mjs";

const cad = (minor) => ({ amount_minor: minor, currency: "CAD", exponent: 2 });

test("credits off -> nothing", () => {
  assert.equal(creditsText({ enabled: false, used: cad(1386) }, null), null);
  assert.equal(creditsText(null, null), null);
});

test("a prepaid balance wins", () => {
  assert.equal(creditsText({ enabled: true, used: cad(500), limit: cad(5000) }, { money: cad(2350) }), "23.50");
});

test("no balance -> the monthly limit less what is used", () => {
  assert.equal(creditsText({ enabled: true, used: cad(1386), limit: cad(5000) }, { money: cad(0) }), "36.14");
});

test("no balance, no limit -> what is used", () => {
  assert.equal(creditsText({ enabled: true, used: cad(1386), limit: null }, null), "13.86used");
});
