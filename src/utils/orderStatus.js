const STATUS_LABELS = {
  pending: "Pending",
  approved: "Approved",
  accepted: "Approved",
  confirmed: "Confirmed",
  preparing: "Preparing",
  processing: "Preparing",
  ready: "Ready",
  "ready for pickup": "Ready",
  "out for delivery": "Out for Delivery",
  "on hold": "On Hold",
  completed: "Completed",
  complete: "Completed",
  delivered: "Completed",
  cancelled: "Cancelled",
  canceled: "Cancelled",
  declined: "Declined",
  rejected: "Rejected",
  unreachable: "Unreachable",
};

const ACTIVE_ORDER_STATUSES = new Set([
  "Pending",
  "Approved",
  "Confirmed",
  "Preparing",
  "Ready",
  "Out for Delivery",
  "On Hold",
]);

export const DELIVERY_GRACE_PERIOD_MS = 10 * 60 * 1000;
export const DELIVERY_WAITING_FEE = 20;

const getTimestampMillis = (timestamp) => {
  if (typeof timestamp?.toMillis === "function") {
    return timestamp.toMillis();
  }
  if (typeof timestamp?.toDate === "function") {
    return timestamp.toDate().getTime();
  }
  if (timestamp instanceof Date) {
    return timestamp.getTime();
  }
  return Number.isFinite(timestamp) ? timestamp : null;
};

const isDeliveryOrder = (order) =>
  String(order?.orderType ?? "").trim().toLowerCase() === "delivery";

/**
 * Request records use "Declined" for rejected requests; rejected orders retain
 * "Rejected" so order and payment states are not presented as request outcomes.
 */
export function normalizeOrderStatus(status, recordType = "order") {
  const normalized = String(status ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

  if (!normalized) return "Pending";
  if (normalized === "rejected" && recordType === "request") {
    return "Declined";
  }
  if (Object.hasOwn(STATUS_LABELS, normalized)) {
    return STATUS_LABELS[normalized];
  }

  return normalized.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

export function getDeliveryGracePeriod(order, now = Date.now()) {
  if (!isDeliveryOrder(order)) return null;

  const startedAt = getTimestampMillis(order.deliveryArrivalAt);
  const currentTime = getTimestampMillis(now);
  if (startedAt === null || currentTime === null) return null;

  const endsAt = startedAt + DELIVERY_GRACE_PERIOD_MS;
  const remainingMs = Math.max(0, endsAt - currentTime);

  return {
    startedAt,
    endsAt,
    remainingMs,
    elapsed: remainingMs === 0,
  };
}

export function hasDeliveryWaitingFee(order) {
  return isDeliveryOrder(order)
    && order.waitingFee === DELIVERY_WAITING_FEE
    && (
      order.waitingFeeApplied === true
      || Boolean(order.waitingFeeAppliedAt)
    );
}

export function canApplyDeliveryWaitingFee(order, now = Date.now()) {
  if (
    !isDeliveryOrder(order)
    || normalizeOrderStatus(order.status) !== "Out for Delivery"
    || (
      order.paymentMethod === "cash"
      && order.cashPaymentStatus !== "unpaid"
    )
    || [
      "waitingFee",
      "waitingFeeApplied",
      "waitingFeeAppliedAt",
      "waitingFeeAppliedBy",
    ].some((field) => Object.hasOwn(order, field))
  ) {
    return false;
  }

  return getDeliveryGracePeriod(order, now)?.elapsed === true;
}

export function formatDeliveryGraceRemaining(remainingMs) {
  const totalSeconds = Math.ceil(Math.max(0, remainingMs) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function isActiveOrder(order) {
  return ACTIVE_ORDER_STATUSES.has(normalizeOrderStatus(order?.status));
}

export function partitionOrders(orders) {
  const active = [];
  const history = [];

  for (const order of orders) {
    (isActiveOrder(order) ? active : history).push(order);
  }

  return { active, history };
}
