const MAX_DELIVERY_PROOF_URL_LENGTH = 2048;

export function normalizeDeliveryProofUrl(value) {
  if (typeof value !== "string") return null;

  const trimmedValue = value.trim();
  if (!trimmedValue || trimmedValue.length > MAX_DELIVERY_PROOF_URL_LENGTH) {
    return null;
  }

  try {
    const url = new URL(trimmedValue);
    if (
      url.protocol !== "https:"
      || !url.hostname
      || url.username
      || url.password
    ) {
      return null;
    }

    return url.href.length <= MAX_DELIVERY_PROOF_URL_LENGTH
      ? url.href
      : null;
  } catch {
    return null;
  }
}
