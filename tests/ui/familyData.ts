// Placeholder family for the M12 UI tests.
import type { Field } from "../../src/api";
import type { MockPage } from "./mock/backend";

const links = (label: string, ...value: string[]): Field => ({ label, type: "links", value });
const born = (year: number): Field => ({ label: "Born", type: "date", options: { age: "birth" }, value: { year } });
const portrait: Field = { label: "Portrait", type: "image", value: { file: "Portrait A.png" } };
const person = (title: string, ...fields: Field[]): MockPage => ({ id: `${title}.md`, title, infobox: { fields } });

export const SETTINGS = {
  hideCategoryBox: false,
  familyTree: {
    parents: [{ field: "Father" }, { field: "Mother" }, { field: "Adoptive father", line: "dashed" }],
    partners: [{ field: "Spouse" }, { field: "Lover", line: "dashed" }],
  },
};

/** Placeholder people: grandparents, parents, the centre (Person C) and their families. */
export const FAMILY: MockPage[] = [
  person("Person GA", links("Spouse", "Person GB")),
  person("Person GB", portrait),
  person("Person F", links("Father", "Person GA"), links("Mother", "Person GB"), links("Spouse", "[[Person M]] (m. 283)"), links("Lover", "Person L"), born(260), portrait),
  person("Person H", links("Father", "Person GA"), links("Spouse", "Person U")),
  person("Person U"),
  person("Person M", links("Father", "Person MZ"), links("Spouse", "Person F")),
  person("Person L"),
  person("Person C", links("Father", "Person F"), links("Mother", "Person M"), links("Spouse", "Person W"), born(290), portrait),
  person("Person S", links("Father", "Person F"), links("Mother", "Person M"), links("Spouse", "Person J"), born(288)),
  person("Person K", links("Father", "Person F"), links("Mother", "Person L")),
  person("Person J", links("Father", "Person U"), links("Mother", "Person H")),
  person("Person I", links("Mother", "Person H")),
  person("Person W"),
  person("Person X", links("Father", "Person C"), links("Mother", "Person W")),
  { id: "Person Q.md", title: "Person Q", infobox: { fields: [{ ...links("Father", "Person C"), spoiler: true }] } },
  { id: "Page A.md", title: "Page A", body: "Not in any family." },
];

