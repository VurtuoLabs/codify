import { createElement } from "lwc";
import CodifyHomeDashboard from "c/codifyHomeDashboard";
import getSummary from "@salesforce/apex/Codify_HomeDashboardController.getSummary";
import getChanges from "@salesforce/apex/Codify_ChangeLogConsoleController.getChanges";

// Both Apex methods are cacheable and consumed through @wire, so they are mocked
// as test wire adapters and driven with emit()/error().
jest.mock(
  "@salesforce/apex/Codify_HomeDashboardController.getSummary",
  () => {
    const { createApexTestWireAdapter } = require("@salesforce/sfdx-lwc-jest");
    return { default: createApexTestWireAdapter(jest.fn()) };
  },
  { virtual: true }
);

jest.mock(
  "@salesforce/apex/Codify_ChangeLogConsoleController.getChanges",
  () => {
    const { createApexTestWireAdapter } = require("@salesforce/sfdx-lwc-jest");
    return { default: createApexTestWireAdapter(jest.fn()) };
  },
  { virtual: true }
);

const SUMMARY = {
  resolutionsThisWeek: 3,
  resolutionsAllTime: 21,
  articlesDrafted: 12,
  articlesPending: 6,
  articlesPublished: 6,
  resolutionsTagged: 16,
  resolutionsUntagged: 5,
  casesFlagged: 2,
  escalations: 1,
  topRootCauses: [
    { label: "Firmware Out Of Date", count: 3 },
    { label: "Configuration Error", count: 2 }
  ],
  topTechnicians: [{ label: "Dana Reeve", count: 3 }],
  byChangeType: [{ label: "Case Field Update", count: 9 }],
  trend: [
    { label: "1/1/2026", count: 0 },
    { label: "1/2/2026", count: 2 },
    { label: "1/3/2026", count: 0 },
    { label: "1/4/2026", count: 1 },
    { label: "1/5/2026", count: 0 },
    { label: "1/6/2026", count: 0 },
    { label: "1/7/2026", count: 3 }
  ]
};

const CHANGES = [
  {
    id: "a01000000000001",
    name: "CL-0001",
    changeType: "Case Field Update",
    objectApiName: "Case",
    relatedRecordId: "500000000000001",
    relatedRecordName: "00001234",
    fieldName: "Codify_Root_Cause__c",
    oldValue: null,
    newValue: "Firmware Out Of Date",
    technicianName: "Dana Reeve",
    sourceResolutionLogId: "a02000000000001",
    sourceResolutionLogName: "RL-0001",
    rootCause: "Firmware Out Of Date",
    requiresHumanReview: false,
    createdDate: "2026-01-07T10:15:00.000Z"
  },
  {
    id: "a01000000000002",
    name: "CL-0002",
    changeType: "Article Drafted",
    objectApiName: "Knowledge__kav",
    relatedRecordId: "ka0000000000001",
    relatedRecordName: "Resetting a stalled controller",
    fieldName: null,
    oldValue: null,
    newValue: null,
    technicianName: "Dana Reeve",
    sourceResolutionLogId: "a02000000000001",
    sourceResolutionLogName: "RL-0001",
    rootCause: "Firmware Out Of Date",
    requiresHumanReview: true,
    createdDate: "2026-01-07T10:16:00.000Z"
  }
];

function build() {
  const element = createElement("c-codify-home-dashboard", {
    is: CodifyHomeDashboard
  });
  document.body.appendChild(element);
  return element;
}

function kpiByLabel(element, label) {
  return Array.from(
    element.shadowRoot.querySelectorAll("c-codify-kpi-card")
  ).find((card) => card.label === label);
}

describe("c-codify-home-dashboard", () => {
  afterEach(() => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
    jest.clearAllMocks();
  });

  it("puts every KPI into its loading state before data arrives", () => {
    const element = build();
    const cards = element.shadowRoot.querySelectorAll("c-codify-kpi-card");
    expect(cards.length).toBeGreaterThan(0);
    cards.forEach((card) => expect(card.loading).toBe(true));
  });

  it("makes drafts awaiting a person the hero figure", async () => {
    const element = build();
    getSummary.emit(SUMMARY);
    await Promise.resolve();

    const hero = kpiByLabel(element, "Drafts to review");
    expect(hero.size).toBe("hero");
    expect(hero.value).toBe(6);
    expect(hero.loading).toBe(false);
    // 6 pending of 12 drafted.
    expect(Math.round(hero.progress)).toBe(50);
  });

  it("surfaces the work only a human can clear", async () => {
    const element = build();
    getSummary.emit(SUMMARY);
    await Promise.resolve();

    expect(kpiByLabel(element, "Left unclassified").value).toBe(5);
    expect(kpiByLabel(element, "Escalated this week").value).toBe(1);
    expect(kpiByLabel(element, "Other cases reached").value).toBe(2);
  });

  it("states in one badge whether anything is waiting on a person", async () => {
    const element = build();
    getSummary.emit(SUMMARY);
    await Promise.resolve();

    const badge = element.shadowRoot.querySelector("c-codify-status-badge");
    // 6 pending + 5 unclassified + 1 escalation
    expect(badge.label).toBe("12 waiting on a person");
    expect(badge.tone).toBe("pending");
  });

  it("says so plainly when nothing is waiting", async () => {
    const element = build();
    getSummary.emit({
      ...SUMMARY,
      articlesPending: 0,
      resolutionsUntagged: 0,
      escalations: 0
    });
    await Promise.resolve();

    const badge = element.shadowRoot.querySelector("c-codify-status-badge");
    expect(badge.label).toBe("Nothing waiting on a person");
    expect(badge.tone).toBe("success");
  });

  it("renders the pipeline as four stages against fixes described", async () => {
    const element = build();
    getSummary.emit(SUMMARY);
    await Promise.resolve();

    const stages = element.shadowRoot.querySelectorAll(".codify-stage");
    expect(stages.length).toBe(4);
    const percents = Array.from(
      element.shadowRoot.querySelectorAll(".codify-stage__percent")
    ).map((n) => n.textContent);
    // 21 described, 16 tagged, 12 drafted, 6 published
    expect(percents).toEqual(["100%", "76%", "57%", "29%"]);
  });

  it("draws the knowledge coverage ring from published over described", async () => {
    const element = build();
    getSummary.emit(SUMMARY);
    await Promise.resolve();

    const arc = element.shadowRoot.querySelector(".codify-coverage__value");
    expect(arc.style.strokeDasharray).toBe("29 71");
  });

  it("zero-fills the seven day cadence so a quiet day reads as quiet", async () => {
    const element = build();
    getSummary.emit(SUMMARY);
    await Promise.resolve();

    const columns = element.shadowRoot.querySelectorAll(".codify-spark__col");
    expect(columns.length).toBe(7);
    const counts = Array.from(
      element.shadowRoot.querySelectorAll(".codify-spark__count")
    ).map((n) => n.textContent);
    expect(counts).toEqual(["0", "2", "0", "1", "0", "0", "3"]);
  });

  it("shows the audit trail as a timeline once changes arrive", async () => {
    const element = build();
    getSummary.emit(SUMMARY);
    getChanges.emit(CHANGES);
    await Promise.resolve();

    const items = element.shadowRoot.querySelectorAll(".codify-timeline__item");
    expect(items.length).toBe(2);
    expect(
      element.shadowRoot.querySelector(".codify-timeline__title").textContent
    ).toContain("Codify_Root_Cause__c");
  });

  it("offers an empty state, not a blank card, when nothing has been changed", async () => {
    const element = build();
    getSummary.emit(SUMMARY);
    getChanges.emit([]);
    await Promise.resolve();

    const empty = element.shadowRoot.querySelector("c-codify-empty-state");
    expect(empty).not.toBeNull();
    expect(empty.actionLabel).toBe("Open the change log");
  });

  it("replaces the page with a retryable error, keeping the raw text", async () => {
    // The raw error is logged for developers; silence it so the run stays clean.
    const logged = jest.spyOn(console, "error").mockImplementation(() => {});
    const element = build();
    getSummary.error({ message: "INSUFFICIENT_ACCESS" }, 403);
    await Promise.resolve();
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();

    const errorState = element.shadowRoot.querySelector("c-codify-error-state");
    expect(errorState).not.toBeNull();
    expect(errorState.showRetry).toBe(true);
    expect(errorState.detail).toContain("INSUFFICIENT_ACCESS");
    expect(element.shadowRoot.querySelector(".codify-band")).toBeNull();
  });

  it("collapses the analysis section on request", async () => {
    const element = build();
    getSummary.emit(SUMMARY);
    await Promise.resolve();

    expect(
      element.shadowRoot.querySelectorAll("c-codify-ranked-bars").length
    ).toBe(3);

    const headers = Array.from(
      element.shadowRoot.querySelectorAll("c-codify-section-header")
    );
    const analysis = headers.find((h) => h.title === "What the record shows");
    analysis.dispatchEvent(new CustomEvent("toggle"));
    await Promise.resolve();

    expect(
      element.shadowRoot.querySelectorAll("c-codify-ranked-bars").length
    ).toBe(0);
  });
});
