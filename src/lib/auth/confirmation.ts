// Token hashes are opaque provider credentials (including PKCE-prefixed hashes).
// Bound their size/alphabet here; Supabase verifies authenticity and expiry.
export function isTokenHash(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{32,256}$/.test(value);
}

export function parseConfirmation(token: unknown, type: unknown) {
  if (!isTokenHash(token) || (type !== "email" && type !== "recovery")) return null;
  return { token, mode: type === "recovery" ? "recover" as const : "verify" as const };
}
