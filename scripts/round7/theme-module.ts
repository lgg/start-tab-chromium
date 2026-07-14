import assert from "node:assert/strict";
import { DEFAULT_SETTINGS } from "../../src/lib/start-page-defaults.js";
import { createCustomThemeDraft } from "../../src/lib/start-page-settings-themes.js";

// Execute the split theme module so missing runtime imports cannot be tree-shaken out of npm test.
const draft = createCustomThemeDraft(DEFAULT_SETTINGS, "Fixture theme");
assert.equal(draft.builtIn, false);
assert.equal(draft.name, "Fixture theme");
