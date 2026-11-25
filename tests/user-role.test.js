import assert from "node:assert/strict";
import test from "node:test";

import { getEffectiveRole } from "../src/utils/userRole.js";

test("normalizes the supported explicit roles", () => {
  assert.equal(getEffectiveRole({ role: " ADMIN " }), "admin");
  assert.equal(getEffectiveRole({ role: "staff" }), "staff");
  assert.equal(getEffectiveRole({ role: "customer" }), "customer");
});

test("falls back to admin only for the legacy admin flag", () => {
  assert.equal(getEffectiveRole({ isAdmin: true }), "admin");
  assert.equal(getEffectiveRole({ role: "customer", isAdmin: true }), "customer");
});

test("defaults missing roles to customer and rejects unknown explicit roles", () => {
  assert.equal(getEffectiveRole({}), "customer");
  assert.equal(getEffectiveRole({ role: "" }), "customer");
  assert.equal(getEffectiveRole({ role: "unknown" }), null);
});
