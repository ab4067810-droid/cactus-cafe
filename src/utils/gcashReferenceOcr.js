export const extractGcashReference = (text) => {
  const lines = String(text || "").split(/\r?\n/);
  const findReferenceNumbers = (source) => (
    [...source.matchAll(/(?<!\d)(\d(?:[ \t-]*\d){12})(?!\d)/g)]
      .map((match) => match[1].replace(/\D/g, ""))
      .filter((reference) => reference.length === 13)
  );

  for (let index = 0; index < lines.length; index += 1) {
    if (!/\b(?:ref|reference)\b/i.test(lines[index])) continue;
    const nearbyLines = lines.slice(
      Math.max(0, index - 1),
      Math.min(lines.length, index + 3),
    );
    const [reference] = findReferenceNumbers(nearbyLines.join(" "));
    if (reference) return reference;
  }

  const [reference] = findReferenceNumbers(lines.join(" "));
  return reference || "";
};
