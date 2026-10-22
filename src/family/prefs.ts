// The Family tree screen's choices on this computer (never synced): how many
// generations up and down, "Partners' parents", and the last person shown.
import { usePref } from "../localPrefs";

export interface TreePrefs {
  up: number;
  down: number;
  partnersParents: boolean;
  /** Page id of the last centre person. */
  last: string | null;
}

export const DEFAULT_TREE_PREFS: TreePrefs = { up: 2, down: 3, partnersParents: false, last: null };
export const MAX_GENERATIONS = 10;

export function useTreePrefs(project: string) {
  return usePref(`ownwiki.familyTree.${project}`, DEFAULT_TREE_PREFS);
}
