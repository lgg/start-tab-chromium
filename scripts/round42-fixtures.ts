import assert from "node:assert/strict";
import {
  START_PAGE_ONBOARDING_KEY,
  isStartPageOnboardingComplete,
  onboardingStorageAction,
} from "../src/newtab/onboarding-state.js";

assert.equal(START_PAGE_ONBOARDING_KEY, "startPageOnboarding");
assert.equal(isStartPageOnboardingComplete({ onboarded: true }), true);
assert.equal(isStartPageOnboardingComplete({ onboarded: false }), false);
assert.equal(isStartPageOnboardingComplete({ onboarded: 1 }), false);
assert.equal(isStartPageOnboardingComplete(null), false);
assert.equal(isStartPageOnboardingComplete([]), false);

const inherited = Object.create({ onboarded: true }) as Record<string, unknown>;
assert.equal(isStartPageOnboardingComplete(inherited), false,
  "Inherited onboarding flags must not complete the wizard");

assert.equal(onboardingStorageAction(undefined), null);
assert.equal(onboardingStorageAction({ newValue: { onboarded: true } }), "dismiss");
assert.equal(onboardingStorageAction({ newValue: { onboarded: false } }), "show");
assert.equal(onboardingStorageAction({ newValue: undefined }), "show");
assert.equal(onboardingStorageAction({ newValue: "damaged" }), "show");

console.log("Round 42 fixtures passed");
