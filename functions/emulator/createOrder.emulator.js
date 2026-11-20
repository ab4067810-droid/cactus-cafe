import assert from "node:assert/strict";
import { test } from "node:test";
import * as functions from "../index.js";

test("the legacy createOrder callable is not exported", () => {
  assert.equal("createOrder" in functions, false);
});
