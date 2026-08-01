export const START_PAGE_ONBOARDING_KEY = "startPageOnboarding";

export interface OnboardingStorageChange {
  newValue?: unknown;
}

export type OnboardingStorageAction = "dismiss" | "show" | null;

export function isStartPageOnboardingComplete(value: unknown): boolean {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && Object.prototype.hasOwnProperty.call(value, "onboarded")
    && (value as { onboarded?: unknown }).onboarded === true;
}

export function onboardingStorageAction(change: OnboardingStorageChange | undefined): OnboardingStorageAction {
  if (!change) return null;
  return isStartPageOnboardingComplete(change.newValue) ? "dismiss" : "show";
}
