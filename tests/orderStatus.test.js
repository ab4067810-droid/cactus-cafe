import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canApplyDeliveryWaitingFee,
  DELIVERY_GRACE_PERIOD_MS,
  formatDeliveryGraceRemaining,
  getDeliveryGracePeriod,
  hasDeliveryWaitingFee,
  isActiveOrder,
  normalizeOrderStatus,
  partitionOrders,
} from "../src/utils/orderStatus.js";

describe("customer order status buckets", () => {
  it("normalizes active statuses without regard to case or separators", () => {
    for (const status of [
      "pending",
      "APPROVED",
      "Preparing",
      "READY",
      "out_for_delivery",
      "ON-HOLD",
      "Confirmed",
      "Ready for Pickup",
    ]) {
      assert.equal(isActiveOrder({ status }), true, status);
    }

    assert.equal(normalizeOrderStatus("oN_hOlD"), "On Hold");
  });

  it("puts terminal and unknown statuses in history instead of hiding them", () => {
    for (const status of [
      "Completed",
      "delivered",
      "CANCELLED",
      "Declined",
      "Rejected",
      "Unreachable",
      "Legacy Terminal Status",
    ]) {
      assert.equal(isActiveOrder({ status }), false, status);
    }

    assert.equal(normalizeOrderStatus("rejected"), "Rejected");
    assert.equal(normalizeOrderStatus("rejected", "request"), "Declined");
  });

  it("keeps active orders out of the history tab bucket", () => {
    const orders = [
      { id: "pending", status: "Pending" },
      { id: "approved", status: "Approved" },
      { id: "preparing", status: "Preparing" },
      { id: "ready", status: "Ready" },
      { id: "out-for-delivery", status: "Out for Delivery" },
      { id: "on-hold", status: "On Hold" },
      { id: "completed", status: "Completed" },
      { id: "delivered", status: "Delivered" },
      { id: "cancelled", status: "Cancelled" },
      { id: "declined", status: "Declined" },
      { id: "rejected", status: "Rejected" },
      { id: "unreachable", status: "Unreachable" },
    ];

    const { active, history } = partitionOrders(orders);

    assert.deepEqual(active.map(({ id }) => id), [
      "pending",
      "approved",
      "preparing",
      "ready",
      "out-for-delivery",
      "on-hold",
    ]);
    assert.deepEqual(history.map(({ id }) => id), [
      "completed",
      "delivered",
      "cancelled",
      "declined",
      "rejected",
      "unreachable",
    ]);
    assert.ok(history.every((order) => !isActiveOrder(order)));
  });

  it("routes Unreachable delivery orders only to history", () => {
    const orders = [
      { id: "out-for-delivery", orderType: "delivery", status: "Out for Delivery" },
      { id: "unreachable", orderType: "delivery", status: "Unreachable" },
    ];

    const { active, history } = partitionOrders(orders);

    assert.deepEqual(active.map(({ id }) => id), ["out-for-delivery"]);
    assert.deepEqual(history.map(({ id }) => id), ["unreachable"]);
  });

  it("allows the delivery waiting fee once after the grace period only", () => {
    const arrivedAt = 1_000_000;
    const order = {
      orderType: "delivery",
      status: "Out for Delivery",
      deliveryArrivalAt: arrivedAt,
    };

    assert.equal(
      canApplyDeliveryWaitingFee(order, arrivedAt + DELIVERY_GRACE_PERIOD_MS - 1),
      false,
    );
    assert.equal(
      canApplyDeliveryWaitingFee(order, arrivedAt + DELIVERY_GRACE_PERIOD_MS),
      true,
    );
    assert.equal(
      canApplyDeliveryWaitingFee({
        ...order,
        waitingFee: 20,
        waitingFeeAppliedAt: new Date(arrivedAt + DELIVERY_GRACE_PERIOD_MS),
      }, arrivedAt + DELIVERY_GRACE_PERIOD_MS),
      false,
    );
    assert.equal(
      canApplyDeliveryWaitingFee({
        ...order,
        orderType: "takeout",
      }, arrivedAt + DELIVERY_GRACE_PERIOD_MS),
      false,
    );
    assert.equal(
      canApplyDeliveryWaitingFee({
        ...order,
        paymentMethod: "cash",
        cashPaymentStatus: "paid",
      }, arrivedAt + DELIVERY_GRACE_PERIOD_MS),
      false,
    );
  });

  it("reports grace time and recognizes only the one-time delivery fee", () => {
    const arrivedAt = 2_000_000;
    const gracePeriod = getDeliveryGracePeriod({
      orderType: "delivery",
      deliveryArrivalAt: new Date(arrivedAt),
    }, arrivedAt + 90_000);

    assert.equal(gracePeriod.remainingMs, DELIVERY_GRACE_PERIOD_MS - 90_000);
    assert.equal(gracePeriod.elapsed, false);
    assert.equal(formatDeliveryGraceRemaining(9_000), "0:09");
    assert.equal(
      hasDeliveryWaitingFee({
        orderType: "delivery",
        waitingFee: 20,
        waitingFeeApplied: true,
      }),
      true,
    );
    assert.equal(
      hasDeliveryWaitingFee({
        orderType: "takeout",
        waitingFee: 20,
        waitingFeeApplied: true,
      }),
      false,
    );
    assert.equal(
      hasDeliveryWaitingFee({
        orderType: "delivery",
        waitingFee: "20",
        waitingFeeApplied: true,
      }),
      false,
    );
  });
});
