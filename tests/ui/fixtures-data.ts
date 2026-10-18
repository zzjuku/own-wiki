// Placeholder project used by the tests (neutral names only).
import type { Template } from "../../src/api";
import type { MockPage } from "./mock/backend";

export const TEMPLATE: Template = {
  id: "template-a-k2j4",
  name: "Template A",
  color: "#cedff2",
  categories: ["Category A"],
  starterText: "## Section A\n",
  fields: [
    { key: "f-img", label: "Picture", type: "image" },
    { key: "f-txt", label: "Example field", type: "text" },
    { key: "f-hd", label: "Section heading", type: "heading" },
    { key: "f-lnk", label: "Linked page", type: "links" },
    { key: "f-date", label: "Date field", type: "date" },
  ],
};

const LOREM = "Placeholder text. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.";

export const PAGES: MockPage[] = [
  {
    id: "Page A.md",
    title: "Page A",
    aliases: ["Alias A"],
    categories: ["Category A", "Category B"],
    body: `${LOREM} Links to [[Page B]] and a [[Missing page]].\n\n## Section one\n\n[[File:Picture A.png|right|medium|Caption with [[Page B]]]]${LOREM}\n\n### Subsection\n\n- Item one\n- Item two\n\n## Section two\n\n| Column A | Column B |\n| --- | --- |\n| Cell 1 | Cell 2 |\n\n${LOREM}[^1]\n\n## Section three\n\n<gallery>\nPicture B.png|Gallery caption B\nPicture C.png|Gallery caption C\n</gallery>\n\n[^1]: A footnote.\n`,
    infobox: {
      template: TEMPLATE.id,
      color: "#cedff2",
      fields: [
        { key: "f-img", label: "Picture", type: "image", value: { file: "Picture A.png", caption: "Infobox caption" } },
        { key: "f-txt", label: "Example field", type: "text", value: "Example value" },
        { key: "f-hd", label: "Section heading", type: "heading" },
        { key: "f-lnk", label: "Linked page", type: "links", value: ["Page B"] },
        { key: "f-date", label: "Date field", type: "date", value: { year: 250, era: "AE", qualifier: "c" } },
      ],
      hidden: [],
    },
  },
  { id: "Group A/Page B.md", title: "Page B", body: `${LOREM} Back to [[Page A]].\n\n[[Category:Category A]]`, categories: ["Category A"] },
  { id: "Group A/Page C.md", title: "Page C", body: LOREM },
];
