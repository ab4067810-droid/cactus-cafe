const manilaClock = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Manila",
  weekday: "long",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function getManilaDayState(date = new Date()) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError("A valid date is required.");
  }

  const parts = Object.fromEntries(
    manilaClock
      .formatToParts(date)
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, value]),
  );
  const hour = Number(parts.hour);

  return {
    weekday: parts.weekday,
    isSunday: parts.weekday === "Sunday",
    isSaturdayEvening: parts.weekday === "Saturday" && hour >= 18,
  };
}
