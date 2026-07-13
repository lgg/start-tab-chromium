// Compatibility entry point retained for existing npm commands and developer workflows.
// The implementation lives in scripts/build.mjs so full and blocker-only builds
// cannot silently drift apart.
import "./scripts/build.mjs";
