const supportedRoles = new Set(["admin", "staff", "customer"]);

export function getEffectiveRole(profile) {
  const rawRole = profile?.role;
  const role = typeof rawRole === "string" ? rawRole.trim().toLowerCase() : "";

  if (supportedRoles.has(role)) {
    return role;
  }

  if (profile?.isAdmin === true) {
    return "admin";
  }

  if (
    rawRole === undefined
    || rawRole === null
    || (typeof rawRole === "string" && !rawRole.trim())
  ) {
    return "customer";
  }

  return null;
}
