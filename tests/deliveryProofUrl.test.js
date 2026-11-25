import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeDeliveryProofUrl } from "../src/utils/deliveryProofUrl.js";

describe("delivery Proof of Delivery URL", () => {
  it("normalizes a valid HTTPS image link", () => {
    assert.equal(
      normalizeDeliveryProofUrl("  https://images.example.test/proof.jpg  "),
      "https://images.example.test/proof.jpg",
    );
  });

  it("rejects non-HTTPS, malformed, credentialed, and overlong URLs", () => {
    assert.equal(normalizeDeliveryProofUrl(""), null);
    assert.equal(normalizeDeliveryProofUrl("javascript:alert(1)"), null);
    assert.equal(normalizeDeliveryProofUrl("http://images.example.test/proof.jpg"), null);
    assert.equal(normalizeDeliveryProofUrl("https://"), null);
    assert.equal(
      normalizeDeliveryProofUrl("https://user:pass@images.example.test/proof.jpg"),
      null,
    );
    assert.equal(
      normalizeDeliveryProofUrl(`https://images.example.test/${"a".repeat(2048)}`),
      null,
    );
  });
});
