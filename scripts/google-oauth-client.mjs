const CLIENT_ID_PATTERN = /^[a-zA-Z0-9._-]+\.apps\.googleusercontent\.com$/;
const PLACEHOLDER_PATTERN = /(?:REPLACE|TODO)/i;

export function isValidGoogleOAuthClientId(value) {
  const clientId = typeof value === "string" ? value.trim() : "";
  return Boolean(clientId)
    && CLIENT_ID_PATTERN.test(clientId)
    && !PLACEHOLDER_PATTERN.test(clientId);
}

export function requireGoogleOAuthClientId(value = process.env.GOOGLE_OAUTH_CLIENT_ID) {
  const clientId = typeof value === "string" ? value.trim() : "";
  if (!clientId) {
    throw new Error("GOOGLE_OAUTH_CLIENT_ID is required for the explicit Google build profile");
  }
  if (!isValidGoogleOAuthClientId(clientId)) {
    throw new Error("GOOGLE_OAUTH_CLIENT_ID must be a non-placeholder Chrome OAuth client ending in .apps.googleusercontent.com");
  }
  return clientId;
}
