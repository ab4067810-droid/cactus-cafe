const FALLBACK_CUSTOMER_NAME = "Cactus Café Customer";

export const maskCustomerName = (displayName, email) => {
  const name = typeof displayName === "string" ? displayName.trim() : "";
  const emailPrefix =
    typeof email === "string" ? email.trim().split("@")[0].trim() : "";
  const customerName = name || emailPrefix;

  if (!customerName || customerName === FALLBACK_CUSTOMER_NAME) {
    return FALLBACK_CUSTOMER_NAME;
  }

  const characters = Array.from(customerName);
  const visibleName = characters.slice(0, 4).join("");
  const maskLength = Math.max(3, Math.min(4, characters.length));

  return `${visibleName}${"*".repeat(maskLength)}`;
};
