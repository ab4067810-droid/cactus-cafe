export const DELIVERY_SCOPE_BARANGAYS = Object.freeze([
  "Camangcamang",
  "Rumirang",
  "Tinongan",
  "Guintubhan",
  "Maytubig",
  "Barangay 1 Poblacion",
  "Barangay 2 Poblacion",
  "Barangay 3 Poblacion",
  "Barangay 4 Poblacion",
  "Barangay 5 Poblacion",
  "Barangay 6 Poblacion",
  "Barangay 7 Poblacion",
  "Barangay 8 Poblacion",
  "Barangay 9 Poblacion",
]);

export const normalizeBarangayName = (name) => {
  if (typeof name !== "string") return "";

  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/^(?:barangay|brgy)\s*\.?\s*/, "")
    .replace(/[^a-z0-9]/g, "");
};

const CANONICAL_BARANGAYS_BY_NORMALIZED_NAME = new Map(
  DELIVERY_SCOPE_BARANGAYS.map((barangay) => [
    normalizeBarangayName(barangay),
    barangay,
  ]),
);

export const getCanonicalDeliveryBarangay = (name) =>
  CANONICAL_BARANGAYS_BY_NORMALIZED_NAME.get(normalizeBarangayName(name)) || null;

export const isBarangayInDeliveryScope = (name) =>
  getCanonicalDeliveryBarangay(name) !== null;
