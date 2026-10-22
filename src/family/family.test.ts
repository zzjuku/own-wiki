import { describe, expect, it } from "vitest";
import { Family, type FamilyData, labelText, lifeYears, parentKey } from "./data";
import { layoutTree, type Metrics, type TreeLayout } from "./layout";
import { buildTree, type TBox, type TreeOptions, type TreeSpec, type Unit } from "./model";
import { renameFieldInFamily } from "./settings";

/** A family from names: parents as [child, parent, field], partners as [a, b, field, words]. */
function family(
  names: string[],
  parents: [string, string, number?][],
  partners: [string, string, number?, string?][] = [],
  extra: { spoilers?: string[]; births?: Record<string, number>; placeholders?: string[] } = {},
): { fam: Family; n: (name: string) => number } {
  const n = (name: string) => names.indexOf(name);
  const data: FamilyData = {
    settings: {
      parents: [{ field: "Father" }, { field: "Mother" }, { field: "Adoptive father", line: "dashed" }],
      partners: [{ field: "Spouse" }, { field: "Lover", line: "dashed" }],
    },
    people: names.map((title) => ({
      title,
      ...(extra.placeholders?.includes(title) ? {} : { id: `${title}.md` }),
      ...(extra.births?.[title] !== undefined ? { birth: { year: extra.births[title] } } : {}),
    })),
    parents: parents.map(([c, p, field = 0], pos) => ({
      child: n(c), parent: n(p), field, pos, spoiler: extra.spoilers?.includes(`${c}>${p}`),
    })),
    partners: partners.map(([a, b, field = 0, words], pos) => ({ a: n(a), b: n(b), field, pos, words, spoiler: extra.spoilers?.includes(`${a}~${b}`) })),
  };
  return { fam: new Family(data), n };
}

const OPTS: TreeOptions = { up: 2, down: 3, partnersParents: false, revealAll: false, revealed: new Set() };
const METRICS: Metrics = {
  boxW: 160, boxH: 56, unknownW: 40, stubH: 26, gap: 20, coupleGap: 28, rowGap: 64,
  measure: (t) => t.length * 7, stubText: (b) => `↪ ${b.person}`,
};

const fullBoxes = (spec: TreeSpec, fam: Family) =>
  spec.boxes.filter((b) => b.kind === "person" || b.kind === "placeholder").map((b) => fam.people[b.person!].title);
const stubs = (spec: TreeSpec, fam: Family) => spec.boxes.filter((b) => b.kind === "stub").map((b) => fam.people[b.person!].title);

/** No two boxes in a row overlap. */
function expectNoOverlap(l: TreeLayout) {
  const sorted = [...l.boxes].sort((a, b) => a.y - b.y || a.x - b.x);
  for (let i = 0; i < sorted.length; i++)
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i];
      const b = sorted[j];
      const sameRow = a.y < b.y + b.h && b.y < a.y + a.h;
      if (sameRow) expect(a.x + a.w <= b.x + 0.01 || b.x + b.w <= a.x + 0.01, `${a.key} overlaps ${b.key}`).toBe(true);
    }
}

const at = (l: TreeLayout, fam: Family, title: string) => l.boxes.find((b) => b.box.kind !== "stub" && b.box.person !== undefined && fam.people[b.box.person].title === title)!;

describe("family tree model", () => {
  it("shows parents, siblings, grandparents and children around the centre", () => {
    const { fam, n } = family(
      ["Centre", "Father", "Mother", "Sister", "Grandfather", "Aunt", "Wife", "Son", "Cousin", "Uncle by marriage"],
      [
        ["Centre", "Father"], ["Centre", "Mother", 1], ["Sister", "Father"], ["Sister", "Mother", 1],
        ["Father", "Grandfather"], ["Aunt", "Grandfather"], ["Son", "Centre"], ["Son", "Wife", 1],
        ["Cousin", "Aunt", 1], ["Cousin", "Uncle by marriage"],
      ],
      [["Centre", "Wife"]],
    );
    const spec = buildTree(fam, n("Centre"), OPTS);
    expect(new Set(fullBoxes(spec, fam))).toEqual(new Set(fam.people.map((p) => p.title)));
    expect(stubs(spec, fam)).toEqual([]);
    expect(spec.lineage?.left.unit.box.person).toBe(n("Father"));
    expect(spec.lineage?.right?.unit.box.person).toBe(n("Mother"));
    expect(spec.lineage?.left.up?.left.unit.box.person).toBe(n("Grandfather"));
    const l = layoutTree(spec, METRICS);
    expectNoOverlap(l);
    // Parents above children, partners in one row, the father left of the mother.
    expect(at(l, fam, "Father").y).toBeLessThan(at(l, fam, "Centre").y);
    expect(at(l, fam, "Father").x).toBeLessThan(at(l, fam, "Mother").x);
    expect(at(l, fam, "Wife").y).toBe(at(l, fam, "Centre").y);
    expect(at(l, fam, "Grandfather").y).toBeLessThan(at(l, fam, "Father").y);
    // The aunt sits with her brother (the father) under the grandfather.
    expect(at(l, fam, "Aunt").y).toBe(at(l, fam, "Father").y);
  });

  it("limits generations up and down", () => {
    const { fam, n } = family(["A", "B", "C", "D"], [["B", "A"], ["C", "B"], ["D", "C"]]);
    const spec = buildTree(fam, n("B"), { ...OPTS, up: 0, down: 1 });
    expect(fullBoxes(spec, fam).sort()).toEqual(["B", "C"]);
    expect(spec.lineage).toBeNull();
  });

  it("puts several partners on both sides with their own children and line styles", () => {
    const { fam, n } = family(
      ["A", "Wife", "Lover", "Kid 1", "Kid 2", "Kid 3"],
      [["Kid 1", "A"], ["Kid 1", "Wife", 1], ["Kid 2", "A"], ["Kid 2", "Lover", 1], ["Kid 3", "A"], ["Kid 3", "Wife", 1]],
      [["A", "Wife", 0, "(m. 283)"], ["A", "Lover", 1], ["Lover", "A", 1, "(secretly)"]],
      { births: { "Kid 1": 300, "Kid 3": 290 } },
    );
    const spec = buildTree(fam, n("A"), OPTS);
    const ps = spec.centre.partnerships;
    expect(ps.map((p) => fam.people[p.partner.person!].title)).toEqual(["Wife", "Lover"]);
    expect(ps.map((p) => p.side)).toEqual(["right", "left"]);
    expect(ps[1].style).toBe("dashed");
    expect(ps[0].labels.map((x) => x.text)).toEqual(["(m. 283)"]);
    expect(ps[1].labels.map((x) => x.text)).toEqual(["(secretly)"]);
    // Children by birth.
    expect(ps[0].kids.map((k) => fam.people[k.unit!.box.person!].title)).toEqual(["Kid 3", "Kid 1"]);
    const l = layoutTree(spec, METRICS);
    expectNoOverlap(l);
    expect(at(l, fam, "Lover").x).toBeLessThan(at(l, fam, "A").x);
    expect(at(l, fam, "Wife").x).toBeGreaterThan(at(l, fam, "A").x);
    // Each couple's children hang on their side.
    expect(at(l, fam, "Kid 2").x).toBeLessThan(at(l, fam, "Kid 1").x);
    expect(l.lines.some((x) => x.kind === "couple" && x.style === "dashed")).toBe(true);
    expect(l.labels.map((x) => x.text).sort()).toEqual(["(m. 283)", "(secretly)"]);
  });

  it("groups children with one known parent under a '?' partner", () => {
    const { fam, n } = family(["A", "B", "Kid 1", "Kid 2"], [["Kid 1", "A"], ["Kid 1", "B", 1], ["Kid 2", "A"]]);
    const spec = buildTree(fam, n("A"), OPTS);
    expect(spec.centre.partnerships.map((p) => p.partner.kind)).toEqual(["person", "unknown"]);
    expect(spec.centre.partnerships[1].kids.length).toBe(1);
    // Only single-parent children: they hang from the parent alone.
    const single = family(["A", "Kid"], [["Kid", "A"]]);
    const s2 = buildTree(single.fam, single.n("A"), OPTS);
    expect(s2.centre.partnerships).toEqual([]);
    expect(s2.centre.alone.length).toBe(1);
    // The centre's father alone: the line shows him only, no "?".
    const s3 = buildTree(single.fam, single.n("Kid"), OPTS);
    expect(s3.lineage?.right).toBeNull();
    expectNoOverlap(layoutTree(s3, METRICS));
  });

  it("shows each person once and stubs elsewhere (cousins marrying)", () => {
    const { fam, n } = family(
      ["G", "A", "B", "X", "Y", "Z"],
      [["A", "G"], ["B", "G"], ["X", "A"], ["Y", "B"], ["Z", "X"], ["Z", "Y", 1]],
      [["X", "Y"]],
    );
    const spec = buildTree(fam, n("G"), { ...OPTS, down: 3 });
    const full = fullBoxes(spec, fam);
    expect(full.length).toBe(new Set(full).size);
    expect(new Set(full)).toEqual(new Set(["G", "A", "B", "X", "Y", "Z"]));
    // The couple is drawn at X's place (with their child); Y's place gets a stub of X, X's a stub of Y.
    expect(stubs(spec, fam).sort()).toEqual(["X", "Y"]);
    const stub = spec.boxes.find((b) => b.kind === "stub" && b.person === n("X"))!;
    expect(stub.target).toBe(`n${n("X")}`);
    expectNoOverlap(layoutTree(spec, METRICS));
  });

  it("never hangs on someone being their own ancestor", () => {
    const { fam, n } = family(["A", "B", "C"], [["A", "B"], ["B", "C"], ["C", "A", 1]]);
    for (const p of ["A", "B", "C"]) {
      const spec = buildTree(fam, n(p), { ...OPTS, up: 10, down: 10 });
      const full = fullBoxes(spec, fam);
      expect(full.length).toBe(new Set(full).size);
      expect(stubs(spec, fam).length).toBeGreaterThan(0);
      expectNoOverlap(layoutTree(spec, METRICS));
    }
  });

  it("hides people behind spoiler relations, with their whole branch", () => {
    const { fam, n } = family(
      ["X", "Father", "Mother", "Grandfather", "Secret kid", "Secret kid's son"],
      [["X", "Father"], ["X", "Mother", 1], ["Father", "Grandfather"], ["Secret kid", "X"], ["Secret kid's son", "Secret kid"]],
      [],
      { spoilers: ["X>Father", "Secret kid>X"] },
    );
    const spec = buildTree(fam, n("X"), OPTS);
    expect(fullBoxes(spec, fam).sort()).toEqual(["Mother", "X"]);
    const hidden = spec.boxes.filter((b) => b.kind === "hidden");
    const fatherLink = parentKey(fam.parentsOf[n("X")][0]);
    const kidLink = parentKey(fam.childrenOf[n("X")][0]);
    expect(hidden.map((b) => b.reveal![0]).sort()).toEqual([fatherLink, kidLink].sort());
    expect(spec.lineage?.left.unit.box.kind).toBe("hidden");
    expectNoOverlap(layoutTree(spec, METRICS));
    // Revealing one relation shows that branch.
    const father = fullBoxes(buildTree(fam, n("X"), { ...OPTS, revealed: new Set([fatherLink]) }), fam);
    expect(father).toContain("Grandfather");
    expect(father).not.toContain("Secret kid");
    expect(fullBoxes(buildTree(fam, n("X"), { ...OPTS, revealed: new Set([kidLink]) }), fam)).toContain("Secret kid's son");
    // The eye switch shows everything.
    expect(fullBoxes(buildTree(fam, n("X"), { ...OPTS, revealAll: true }), fam).length).toBe(6);
  });

  it("keeps a secret lover hidden with their line's words", () => {
    const { fam, n } = family(["A", "Lover"], [], [["A", "Lover", 1, "(lovers)"]], { spoilers: ["A~Lover"] });
    const spec = buildTree(fam, n("A"), OPTS);
    const p = spec.centre.partnerships[0];
    expect(p.partner.kind).toBe("hidden");
    expect(p.labels).toEqual([]);
    expect(p.style).toBe("solid");
    const open = buildTree(fam, n("A"), { ...OPTS, revealAll: true }).centre.partnerships[0];
    expect([open.style, open.labels[0]?.text]).toEqual(["dashed", "(lovers)"]);
  });

  it("shows partners' parents only with the switch on", () => {
    const { fam, n } = family(["A", "Wife", "Her father", "Her mother"], [["Wife", "Her father"], ["Wife", "Her mother", 1]], [["A", "Wife"]]);
    expect(fullBoxes(buildTree(fam, n("A"), OPTS), fam).sort()).toEqual(["A", "Wife"]);
    const spec = buildTree(fam, n("A"), { ...OPTS, partnersParents: true });
    expect(spec.centre.partnerships[0].above?.parents.length).toBe(2);
    const l = layoutTree(spec, METRICS);
    expectNoOverlap(l);
    expect(at(l, fam, "Her father").y).toBeLessThan(at(l, fam, "Wife").y);
  });

  it("draws further parents (adoptive) with their own line", () => {
    const { fam, n } = family(["X", "Father", "Mother", "Adopter"], [["X", "Father"], ["X", "Mother", 1], ["X", "Adopter", 2]]);
    const spec = buildTree(fam, n("X"), OPTS);
    expect(fullBoxes(spec, fam).sort()).toEqual(["Adopter", "Father", "Mother", "X"]);
    expect(spec.connectors).toEqual([{ from: `n${n("Adopter")}`, to: `n${n("X")}`, style: "dashed" }]);
    // An adopted child of the centre whose other parents aren't in view hangs from the centre.
    const s2 = buildTree(fam, n("Adopter"), OPTS);
    expect(fullBoxes(s2, fam)).toContain("X");
    expect(s2.centre.alone[0].drop).toBe("dashed");
  });

  it("lays out a big family quickly without overlaps", () => {
    // 6 generations, every couple with 3 children, spouses from outside.
    const names: string[] = ["Root", "Root wife"];
    const parents: [string, string, number?][] = [];
    const partners: [string, string, number?][] = [["Root", "Root wife"]];
    let gen = [["Root", "Root wife"]];
    for (let g = 0; g < 5; g++) {
      const next: string[][] = [];
      for (const [p, q] of gen)
        for (let k = 0; k < 3; k++) {
          const c = `${p}.${k}`;
          const s = `${c} spouse`;
          names.push(c, s);
          parents.push([c, p], [c, q, 1]);
          partners.push([c, s]);
          next.push([c, s]);
        }
      gen = next;
    }
    const { fam, n } = family(names, parents, partners);
    const t = performance.now();
    const spec = buildTree(fam, n("Root.1.1"), { ...OPTS, up: 2, down: 3 });
    const l = layoutTree(spec, METRICS);
    const ms = performance.now() - t;
    expect(l.boxes.length).toBeGreaterThan(200);
    expectNoOverlap(l);
    expect(ms).toBeLessThan(500);
  });
});

describe("family tree text", () => {
  it("writes years", () => {
    expect(lifeYears({ title: "A", birth: { year: 250, qualifier: "c" }, death: { year: 300, era: "AC" } }, false)).toBe("c. 250 – 300 AC");
    expect(lifeYears({ title: "A", birth: { year: 283, era: "AC" } }, false)).toBe("b. 283 AC");
    expect(lifeYears({ title: "A", birth: { year: 250, era: "BC" }, death: { year: 3, era: "AC" } }, false)).toBe("250 BC – 3 AC");
    expect(lifeYears({ title: "A", birth: { year: 283 }, death: { year: 300, spoiler: true } }, false)).toBe("b. 283");
    expect(lifeYears({ title: "A", birth: { year: 283 }, death: { year: 300, spoiler: true } }, true)).toBe("283 – 300");
    expect(lifeYears({ title: "A", death: { year: 300, qualifier: "before" } }, false)).toBe("d. bef. 300");
  });

  it("blots out spoilers in couple words", () => {
    expect(labelText("(m. ||283||)", false)).toBe("(m. ▒▒▒)");
    expect(labelText("(m. ||283||)", true)).toBe("(m. 283)");
  });
});

// (Keeps the type import used.)
export type { TBox, Unit };

describe("family tree settings", () => {
  const template = (...labels: string[]) => ({ id: "t", name: "T", fields: labels.map((label) => ({ label, type: "links" as const })) });
  it("follow a renamed template field", () => {
    const ft = { parents: [{ field: "Father", line: "dashed", extra: 1 }], partners: [{ field: "Spouse" }], other: true };
    expect(renameFieldInFamily(ft, [template("Sire")], "father", "Sire")).toEqual({
      parents: [{ field: "Sire", line: "dashed", extra: 1 }],
      partners: [{ field: "Spouse" }],
      other: true,
    });
    // Another template still has the old name: the new one is added after it.
    expect(renameFieldInFamily(ft, [template("Sire"), template("Father")], "Father", "Sire")?.parents).toEqual([
      { field: "Father", line: "dashed", extra: 1 },
      { field: "Sire", line: "dashed", extra: 1 },
    ]);
    expect(renameFieldInFamily(ft, [], "Other", "New")).toBeNull();
    expect(renameFieldInFamily(null, [], "Father", "New")).toBeNull();
  });
});
