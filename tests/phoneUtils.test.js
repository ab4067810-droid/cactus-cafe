import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isValidPHPhone,
  normalizePHPhone,
} from "../src/utils/phoneUtils.js";

describe("Philippine phone normalization", () => {
  it("normalizes local, national, and international mobile formats", () => {
    for (const phone of [
      "0917 123 4567",
      "0917-123-4567",
      "(0917) 123 4567",
      "+639171234567",
      "639171234567",
      "9171234567",
    ]) {
      assert.equal(normalizePHPhone(phone), "09171234567");
      assert.equal(isValidPHPhone(phone), true);
    }
  });

  it("rejects landlines, malformed numbers, and unsupported characters", () => {
    for (const phone of [
      "",
      "02 8123 4567",
      "0917123456",
      "091712345678",
      "+63 917 123 4567 ext 2",
      null,
    ]) {
      assert.equal(normalizePHPhone(phone), "");
      assert.equal(isValidPHPhone(phone), false);
    }
  });
});
