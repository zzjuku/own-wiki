// Family tree data (M12) as Rust sends it (src-tauri/src/family.rs), and an
// index over it: each person's parents, children and partners, with both
// sides of a partner link merged into one couple.
import { compareNames } from "../tree";

export type LineStyle = "solid" | "dashed" | "dotted";
export const LINE_STYLES: LineStyle[] = ["solid", "dashed", "dotted"];

/** One field of the Family tree settings (unknown keys are kept). */
export interface FieldStyle {
  field: string;
  line?: string;
  [extra: string]: unknown;
}

/** project.json `familyTree`. */
export interface FamilySettings {
  parents?: FieldStyle[];
  partners?: FieldStyle[];
  [extra: string]: unknown;
}

export interface LifeDate {
  year: number;
  month?: number;
  day?: number;
  era?: string;
  qualifier?: string;
  spoiler?: boolean;
}

export interface FamilyPerson {
  /** The page; none for a name no page has (a placeholder). */
  id?: string;
  title: string;
  aliases?: string[];
  image?: string;
  template?: string;
  birth?: LifeDate;
  death?: LifeDate;
}

export interface ParentLink {
  child: number;
  parent: number;
  /** Place of the field in the settings' parent fields. */
  field: number;
  pos: number;
  spoiler?: boolean;
  typed?: boolean;
  loop?: boolean;
}

export interface PartnerLink {
  /** Stored on a's page. */
  a: number;
  b: number;
  field: number;
  pos: number;
  spoiler?: boolean;
  words?: string;
}

export interface FamilyData {
  settings: { parents: FieldStyle[]; partners: FieldStyle[] };
  people: FamilyPerson[];
  parents: ParentLink[];
  partners: PartnerLink[];
}

export const lineStyle = (s: string | undefined): LineStyle => (s === "dashed" || s === "dotted" ? s : "solid");
const WEIGHT: Record<LineStyle, number> = { solid: 0, dashed: 1, dotted: 2 };
/** The less certain of two line styles (a child's line when its parents' fields differ). */
export const weaker = (a: LineStyle, b: LineStyle): LineStyle => (WEIGHT[b] > WEIGHT[a] ? b : a);

/** Words on a couple line, from one side's partner link. */
export interface CoupleLabel {
  text: string;
  spoiler?: boolean;
}

/** Both sides of a partner link, merged. */
export interface Couple {
  other: number;
  /** Key for revealing it ("r<a>-<b>"). */
  key: string;
  /** The first partner field (in settings order) linking them. */
  field: number;
  style: LineStyle;
  /** Every link between them is a spoiler. */
  spoiler: boolean;
  labels: CoupleLabel[];
  /** Order on this person's side: links stored on their own page first. */
  order: [number, number, number];
}

export const parentKey = (l: ParentLink) => `p${l.child}-${l.parent}`;
export const coupleKey = (a: number, b: number) => `r${Math.min(a, b)}-${Math.max(a, b)}`;

/** Birth date as a sort key (spoiler dates don't count, so the order can't give them away). */
function birthKey(p: FamilyPerson): number[] | null {
  const b = p.birth;
  return b && !b.spoiler ? [b.year, b.month ?? 0, b.day ?? 0] : null;
}

/** Children order: by birth date, else natural title order; people without a date last. */
export function compareBirth(a: FamilyPerson, b: FamilyPerson): number {
  const ka = birthKey(a);
  const kb = birthKey(b);
  if (ka && kb) {
    for (let i = 0; i < 3; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
  } else if (ka || kb) return ka ? -1 : 1;
  return compareNames(a.title, b.title);
}

export class Family {
  readonly people: FamilyPerson[];
  readonly parentStyles: LineStyle[];
  readonly partnerStyles: LineStyle[];
  /** Each person's parent links, in the parents' order (field, then entry). */
  readonly parentsOf: ParentLink[][];
  /** Links to each person's children, in birth order. */
  readonly childrenOf: ParentLink[][];
  readonly couplesOf: Couple[][];
  /** Page id -> person. */
  readonly byPage = new Map<string, number>();

  constructor(data: FamilyData) {
    this.people = data.people;
    const n = data.people.length;
    this.parentStyles = data.settings.parents.map((f) => lineStyle(f.line));
    this.partnerStyles = data.settings.partners.map((f) => lineStyle(f.line));
    this.parentsOf = Array.from({ length: n }, () => []);
    this.childrenOf = Array.from({ length: n }, () => []);
    this.couplesOf = Array.from({ length: n }, () => []);
    data.people.forEach((p, i) => p.id && this.byPage.set(p.id, i));
    for (const l of data.parents) {
      this.parentsOf[l.child].push(l);
      this.childrenOf[l.parent].push(l);
    }
    this.parentsOf.forEach((list) => list.sort((a, b) => a.field - b.field || a.pos - b.pos));
    this.childrenOf.forEach((list) => list.sort((a, b) => compareBirth(this.people[a.child], this.people[b.child])));
    // Couples: every link between two people, from either side.
    const pairs = new Map<string, PartnerLink[]>();
    for (const l of data.partners) {
      const k = coupleKey(l.a, l.b);
      if (!pairs.has(k)) pairs.set(k, []);
      pairs.get(k)!.push(l);
    }
    for (const [key, links] of pairs) {
      const field = Math.min(...links.map((l) => l.field));
      const spoiler = links.every((l) => l.spoiler);
      const labels: CoupleLabel[] = [];
      for (const l of links) {
        const text = l.words?.trim();
        if (text && !labels.some((x) => x.text === text)) labels.push({ text, spoiler: !!l.spoiler });
      }
      const ends = [links[0].a, links[0].b];
      for (const [me, other] of [ends, [...ends].reverse()]) {
        const own = links.filter((l) => l.a === me).sort((x, y) => x.field - y.field || x.pos - y.pos)[0];
        const theirs = links.filter((l) => l.a === other).sort((x, y) => x.field - y.field || x.pos - y.pos)[0];
        const order: [number, number, number] = own ? [0, own.field, own.pos] : [1, theirs.field, theirs.pos];
        this.couplesOf[me].push({ other, key, field, style: this.partnerStyles[field] ?? "solid", spoiler, labels, order });
      }
    }
    this.couplesOf.forEach((list) => list.sort((a, b) => a.order[0] - b.order[0] || a.order[1] - b.order[1] || a.order[2] - b.order[2]));
  }

  /** Line style of a parent link's field. */
  style(l: ParentLink): LineStyle {
    return this.parentStyles[l.field] ?? "solid";
  }

  /** Has any parent, child or partner. */
  inFamily(i: number): boolean {
    return this.parentsOf[i].length + this.childrenOf[i].length + this.couplesOf[i].length > 0;
  }
}

// ---- what boxes and lines say ----

const QUALIFIER: Record<string, string> = { c: "c. ", before: "bef. ", after: "aft. " };

function yearText(d: LifeDate, era: boolean): string {
  const year = d.year < 0 ? `−${-d.year}` : String(d.year);
  return `${QUALIFIER[d.qualifier ?? ""] ?? ""}${year}${era && d.era ? ` ${d.era}` : ""}`;
}

/**
 * Years under a name: "c. 250 – 300 AC", "b. 283", "d. 300". Spoiler dates
 * show only with `spoilers` on (a hidden death date isn't hinted at either).
 */
export function lifeYears(p: FamilyPerson, spoilers: boolean): string {
  const birth = p.birth && (!p.birth.spoiler || spoilers) ? p.birth : null;
  const death = p.death && (!p.death.spoiler || spoilers) ? p.death : null;
  if (birth && death) {
    const same = (birth.era ?? "") === (death.era ?? "");
    return `${yearText(birth, !same)} – ${yearText(death, true)}`;
  }
  if (birth) return `b. ${yearText(birth, true)}`;
  if (death) return `d. ${yearText(death, true)}`;
  return "";
}

/** A couple label's text with `||spoilers||` blotted out unless shown. */
export function labelText(text: string, spoilers: boolean): string {
  return spoilers ? text.replace(/\|\|([^|\s][^\n]*?)\|\|/g, "$1") : text.replace(/\|\|[^|\s][^\n]*?\|\|/g, "▒▒▒");
}
