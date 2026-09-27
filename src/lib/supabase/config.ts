export class ConfigurationError extends Error {
  constructor() {
    super("Authentication configuration is missing or invalid.");
    this.name = "ConfigurationError";
  }
}

export function parseOrigin(value: string | undefined): string {
  if (!value) throw new ConfigurationError();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigurationError();
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
    url.username || url.password || url.search || url.hash || url.pathname !== "/"
  ) throw new ConfigurationError();
  return url.origin;
}

export function parseSupabaseConfig(url: string | undefined, key: string | undefined) {
  // Accept only the modern public key format, never secret/service-role JWTs.
  if (!key || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) {
    throw new ConfigurationError();
  }
  return { url: parseOrigin(url), key };
}

export function getSupabaseConfig() {
  return parseSupabaseConfig(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}

export function isSupabaseConfigured() {
  try {
    getSupabaseConfig();
    return true;
  } catch (error) {
    if (error instanceof ConfigurationError) return false;
    throw error;
  }
}
