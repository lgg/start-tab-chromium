export function hashTargetsSection(hash: string, sectionId: string): boolean {
  if (!hash.startsWith("#")) return false;
  try {
    return decodeURIComponent(hash.slice(1)) === sectionId;
  } catch {
    return hash.slice(1) === sectionId;
  }
}

export function restoreDeferredSectionAnchor(section: HTMLElement, hash = window.location.hash): boolean {
  if (!hashTargetsSection(hash, section.id)) return false;
  section.scrollIntoView({ block: "start" });
  return true;
}
