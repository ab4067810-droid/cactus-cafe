export const PH_PHONE_VALIDATION_ERROR =
  "Enter a valid 11-digit Philippine mobile number (e.g., 0917 123 4567).";

export const normalizePHPhone = (raw) => {
  if (typeof raw !== "string" && typeof raw !== "number") return "";

  const phone = String(raw).trim().replace(/[\s()-]/g, "");

  if (/^09\d{9}$/.test(phone)) return phone;
  if (/^\+?639\d{9}$/.test(phone)) return `0${phone.replace(/^\+?63/, "")}`;
  if (/^9\d{9}$/.test(phone)) return `0${phone}`;

  return "";
};

export const isValidPHPhone = (raw) => Boolean(normalizePHPhone(raw));
