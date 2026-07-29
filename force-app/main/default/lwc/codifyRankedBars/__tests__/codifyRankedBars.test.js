import { createElement } from "lwc";
import CodifyRankedBars from "c/codifyRankedBars";

function build(props = {}) {
  const element = createElement("c-codify-ranked-bars", {
    is: CodifyRankedBars
  });
  Object.assign(element, props);
  document.body.appendChild(element);
  return element;
}

const ROWS = [
  { label: "Firmware Out Of Date", count: 8 },
  { label: "Configuration Error", count: 4 },
  { label: "Network Connectivity", count: 1 }
];

describe("c-codify-ranked-bars", () => {
  afterEach(() => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  it("renders one row per tally with its figure", () => {
    const element = build({ rows: ROWS });
    const items = element.shadowRoot.querySelectorAll(".codify-ranked__row");
    expect(items.length).toBe(3);
    const values = Array.from(
      element.shadowRoot.querySelectorAll(".codify-ranked__value")
    ).map((n) => n.textContent);
    expect(values).toEqual(["8", "4", "1"]);
  });

  it("scales bars against the largest value in the set", () => {
    const element = build({ rows: ROWS });
    const bars = element.shadowRoot.querySelectorAll(".codify-ranked__bar");
    expect(bars[0].style.width).toBe("100%");
    expect(bars[1].style.width).toBe("50%");
  });

  it("gives a non-zero value a visible sliver so 1 never looks like 0", () => {
    const element = build({
      rows: [
        { label: "Rare", count: 1 },
        { label: "Common", count: 200 }
      ]
    });
    const bars = element.shadowRoot.querySelectorAll(".codify-ranked__bar");
    expect(parseInt(bars[1].style.width, 10)).toBeGreaterThan(0);
  });

  it("caps the list and says how many are hidden", () => {
    const many = Array.from({ length: 9 }, (unused, i) => ({
      label: `Cause ${i}`,
      count: 9 - i
    }));
    const element = build({ rows: many, limit: 6 });
    expect(
      element.shadowRoot.querySelectorAll(".codify-ranked__row").length
    ).toBe(6);
    expect(
      element.shadowRoot.querySelector(".codify-ranked__more").textContent
    ).toBe("3 more not shown");
  });

  it("shows a skeleton while loading, not an empty state", () => {
    const element = build({ rows: [], loading: true });
    expect(
      element.shadowRoot.querySelector("c-codify-skeleton-loader")
    ).not.toBeNull();
    expect(element.shadowRoot.querySelector("c-codify-empty-state")).toBeNull();
  });

  it("explains an empty set rather than rendering a blank block", () => {
    const element = build({
      rows: [],
      emptyTitle: "Nothing tagged yet",
      emptyMessage: "Root causes appear once a recap corroborates one."
    });
    const empty = element.shadowRoot.querySelector("c-codify-empty-state");
    expect(empty).not.toBeNull();
    expect(empty.title).toBe("Nothing tagged yet");
  });
});
