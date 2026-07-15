const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() ?? "";

if (!clientId) {
  throw new Error("GOOGLE_OAUTH_CLIENT_ID is required for npm run build:google");
}

if (!/^[a-zA-Z0-9._-]+\.apps\.googleusercontent\.com$/.test(clientId)) {
  throw new Error("GOOGLE_OAUTH_CLIENT_ID must be a Chrome OAuth client ending in .apps.googleusercontent.com");
}

console.log("Google OAuth build configuration validated");
