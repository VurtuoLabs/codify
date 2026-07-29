import { createElement } from "lwc";
import CodifyRootCauseTrends from "c/codifyRootCauseTrends";
import getRootCauseTrends from "@salesforce/apex/Codify_HomeDashboardController.getRootCauseTrends";

jest.mock(
  "@salesforce/apex/Codify_HomeDashboardController.getRootCauseTrends",
  () => {
    const { createApexTestWireAdapter } = require("@salesforce/sfdx-lwc-jest");
    return { default: createApexTestWireAdapter(jest.fn()) };
  },
  { virtual: true }
);

const TRENDS = [
  {
    // Recurs, nothing written up: the gap this tab exists to surface.
    rootCause: "Firmware Out Of Date",
    occurrences: 9,
    articlesDrafted: 0,
    relatedCasesFlagged: 4,
    lastSeen: "2026-01-07T09:00:00.000Z"
  },
  {
    // Well covered.
    rootCause: "Configuration Error",
    occurrences: 4,
    articlesDrafted: 2,
    relatedCasesFlagged: 1,
    lastSeen: "2026-01-06T09:00:00.000Z"
  },
  {
    // Covered, but thinly: more than three cases per article.
    rootCause: "Network Connectivity",
    occurrences: 7,
    articlesDrafted: 1,
    relatedCasesFlagged: 0,
    lastSeen: "2026-01-05T09:00:00.000Z"
  },
  {
    // Seen once with no article: not a gap yet.
    rootCause: "Wear And Tear",
    occurrences: 1,
    articlesDrafted: 0,
    relatedCasesFlagged: 0,
    lastSeen: "2026-01-04T09:00:00.000Z"
  }
];

function build() {
  const element = createElement("c-codify-root-cause-trends", {
    is: CodifyRootCauseTrends
  });
  document.body.appendChild(element);
  return element;
}

function coverageLabels(element) {
  return Array.from(
    element.shadowRoot.querySelectorAll("c-codify-status-badge")
  ).map((b) => b.label);
}

function kpiByLabel(element, label) {
  return Array.from(
    element.shadowRoot.querySelectorAll("c-codify-kpi-card")
  ).find((card) => card.label === label);
}

describe("c-codify-root-cause-trends", () => {
  afterEach(() => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
    jest.clearAllMocks();
  });

  it("shows skeleton rows on first load, not an empty state", () => {
    const element = build();
    expect(
      element.shadowRoot.querySelector("c-codify-skeleton-loader")
    ).not.toBeNull();
    expect(element.shadowRoot.querySelector("c-codify-empty-state")).toBeNull();
  });

  it("classifies coverage with the original thresholds", async () => {
    const element = build();
    getRootCauseTrends.emit(TRENDS);
    await Promise.resolve();

    expect(coverageLabels(element)).toEqual([
      "Gap", // 9 occurrences, no article
      "Thin", // 7 occurrences, 1 article
      "Documented", // 4 occurrences, 2 articles
      "Not yet" // seen once, no article
    ]);
  });

  it("counts the gaps into a KPI so the tab states its own verdict", async () => {
    const element = build();
    getRootCauseTrends.emit(TRENDS);
    await Promise.resolve();

    const gaps = kpiByLabel(element, "Coverage gaps");
    expect(gaps.value).toBe(1);
    expect(gaps.tone).toBe("critical");
    expect(kpiByLabel(element, "Recurring causes").value).toBe(3);
    expect(kpiByLabel(element, "Cases reached by the sweep").value).toBe(5);
  });

  it("turns the gap KPI green when every recurring cause is covered", async () => {
    const element = build();
    getRootCauseTrends.emit([TRENDS[1]]);
    await Promise.resolve();

    const gaps = kpiByLabel(element, "Coverage gaps");
    expect(gaps.value).toBe(0);
    expect(gaps.tone).toBe("good");
  });

  it("ranks most recurrent first by default", async () => {
    const element = build();
    getRootCauseTrends.emit(TRENDS);
    await Promise.resolve();

    const counts = Array.from(
      element.shadowRoot.querySelectorAll(".codify-rank__count")
    ).map((n) => n.textContent);
    expect(counts).toEqual(["9", "7", "4", "1"]);
  });

  it("scales the ranked bar against the largest value in the set", async () => {
    const element = build();
    getRootCauseTrends.emit(TRENDS);
    await Promise.resolve();

    const bars = element.shadowRoot.querySelectorAll(".codify-rank__bar");
    expect(bars[0].style.width).toBe("100%");
    expect(bars[2].style.width).toBe("44%");
  });

  it("can sort the worst coverage to the top", async () => {
    const element = build();
    getRootCauseTrends.emit(TRENDS);
    await Promise.resolve();

    const sort = element.shadowRoot.querySelectorAll("lightning-combobox")[0];
    sort.dispatchEvent(new CustomEvent("change", { detail: { value: "gap" } }));
    await Promise.resolve();

    expect(coverageLabels(element)[0]).toBe("Gap");
    expect(coverageLabels(element)[1]).toBe("Thin");
  });

  it("filters by search and explains an empty result", async () => {
    const element = build();
    getRootCauseTrends.emit(TRENDS);
    await Promise.resolve();

    // The only lightning-input on this tab is the root cause search box.
    const search = element.shadowRoot.querySelector("lightning-input");
    search.value = "network";
    search.dispatchEvent(new CustomEvent("change"));
    await Promise.resolve();

    expect(
      element.shadowRoot.querySelectorAll(".codify-rank__row").length
    ).toBe(1);

    search.value = "nothing matches this";
    search.dispatchEvent(new CustomEvent("change"));
    await Promise.resolve();

    const empty = element.shadowRoot.querySelector("c-codify-empty-state");
    expect(empty).not.toBeNull();
    expect(empty.message).toContain("nothing matches this");
    expect(empty.actionLabel).toBe("Clear the search");
  });

  it("caps the list and offers to show the rest", async () => {
    const many = Array.from({ length: 14 }, (unused, i) => ({
      rootCause: `Cause ${i}`,
      occurrences: 14 - i,
      articlesDrafted: 1,
      relatedCasesFlagged: 0,
      lastSeen: "2026-01-07T09:00:00.000Z"
    }));
    const element = build();
    getRootCauseTrends.emit(many);
    await Promise.resolve();

    expect(
      element.shadowRoot.querySelectorAll(".codify-rank__row").length
    ).toBe(10);

    const more = element.shadowRoot.querySelector(
      ".codify-rank__more lightning-button"
    );
    expect(more.label).toBe("Show all 14 root causes");
    more.click();
    await Promise.resolve();

    expect(
      element.shadowRoot.querySelectorAll(".codify-rank__row").length
    ).toBe(14);
  });

  it("explains an empty window rather than showing a blank card", async () => {
    const element = build();
    getRootCauseTrends.emit([]);
    await Promise.resolve();

    const empty = element.shadowRoot.querySelector("c-codify-empty-state");
    expect(empty.message).toContain("corroborates it twice");
  });

  it("offers a retry with the raw error kept for developers", async () => {
    const logged = jest.spyOn(console, "error").mockImplementation(() => {});
    const element = build();
    getRootCauseTrends.error({ message: "QUERY_TIMEOUT" }, 500);
    await Promise.resolve();
    logged.mockRestore();

    const errorState = element.shadowRoot.querySelector("c-codify-error-state");
    expect(errorState.showRetry).toBe(true);
    expect(errorState.detail).toContain("QUERY_TIMEOUT");
  });
});
