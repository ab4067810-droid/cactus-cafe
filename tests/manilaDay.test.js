import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getManilaDayState } from "../src/utils/manilaDay.js";

describe("Manila delivery day clock", () => {
  it("uses Asia/Manila for the Saturday-evening warning boundary", () => {
    assert.equal(
      getManilaDayState(new Date("2026-11-21T09:59:00Z")).isSaturdayEvening,
      false,
    );
    assert.equal(
      getManilaDayState(new Date("2026-11-21T10:00:00Z")).isSaturdayEvening,
      true,
    );
  });

  it("detects Sunday after the Manila date changes", () => {
    assert.equal(
      getManilaDayState(new Date("2026-11-21T15:59:00Z")).isSunday,
      false,
    );
    assert.equal(
      getManilaDayState(new Date("2026-11-21T16:00:00Z")).isSunday,
      true,
    );
  });
});
