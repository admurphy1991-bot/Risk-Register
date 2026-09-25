// Client-safe role constants (auth.ts imports next/headers, so it can't be
// used from client components).

/** admin: everything incl. settings/users · hs: reviews & approves TAs · manager: builds TAs */
export const USER_ROLES = ["admin", "hs", "manager"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  hs: "H&S reviewer",
  manager: "Project manager",
};

export function canReviewRole(role: string) {
  return role === "admin" || role === "hs";
}
