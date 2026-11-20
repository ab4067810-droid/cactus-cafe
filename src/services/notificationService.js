import {
  collection,
  doc,
  runTransaction,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";

const createNotificationData = ({
  userId,
  type,
  itemId,
  title,
  message,
}) => ({
  userId,
  type,
  itemId,
  title,
  message,
  isRead: false,
  createdAt: serverTimestamp(),
});

export async function createCustomerNotification({
  database,
  userId,
  type,
  itemId,
  title,
  message,
}) {
  if (!database) throw new Error("A Firestore database instance is required.");
  if (typeof userId !== "string" || !userId.trim()) {
    throw new Error("A customer user ID is required for a notification.");
  }
  if (!["order", "reservation"].includes(type)) {
    throw new Error("Notification type must be order or reservation.");
  }
  if (typeof itemId !== "string" || !itemId.trim()) {
    throw new Error("A notification item ID is required.");
  }
  if (typeof title !== "string" || !title.trim()) {
    throw new Error("A notification title is required.");
  }
  if (typeof message !== "string" || !message.trim()) {
    throw new Error("A notification message is required.");
  }

  const notificationRef = doc(collection(database, "notifications"));
  const batch = writeBatch(database);
  batch.set(
    notificationRef,
    createNotificationData({ userId, type, itemId, title, message }),
  );
  await batch.commit();
  return notificationRef.id;
}

export async function updateStatusWithNotification({
  database,
  collectionName,
  itemId,
  userIdField,
  type,
  newStatus,
  title,
  message,
}) {
  if (!database) throw new Error("A Firestore database instance is required.");
  if (!["orders", "reservations"].includes(collectionName)) {
    throw new Error("Unsupported notification item collection.");
  }
  if (!["customerId", "userId"].includes(userIdField)) {
    throw new Error("Unsupported notification owner field.");
  }
  if (!["order", "reservation"].includes(type)) {
    throw new Error("Notification type must be order or reservation.");
  }

  const itemRef = doc(database, collectionName, itemId);
  const notificationRef = doc(collection(database, "notifications"));

  return runTransaction(database, async (transaction) => {
    const itemSnapshot = await transaction.get(itemRef);
    if (!itemSnapshot.exists()) {
      throw new Error(`The ${type} no longer exists.`);
    }

    const item = itemSnapshot.data();
    const previousStatus = item.status || "Pending";
    if (previousStatus === newStatus) {
      return { changed: false, previousStatus };
    }

    transaction.update(itemRef, { status: newStatus });

    const userId = item[userIdField];
    if (typeof userId !== "string" || !userId.trim()) {
      return {
        changed: true,
        previousStatus,
        notificationCreated: false,
      };
    }

    transaction.set(
      notificationRef,
      createNotificationData({
        userId,
        type,
        itemId,
        title,
        message: message(newStatus),
      }),
    );

    return { changed: true, previousStatus, notificationCreated: true };
  });
}
