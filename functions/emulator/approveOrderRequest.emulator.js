import assert from "node:assert/strict";
import { test } from "node:test";
import * as functions from "../index.js";

test("the legacy approveOrderRequest callable is not exported", () => {
  assert.equal("approveOrderRequest" in functions, false);
});
