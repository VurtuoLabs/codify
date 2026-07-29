import { createElement } from "lwc";
import CodifyCaseHistoryBadge from "c/codifyCaseHistoryBadge";
import countForRecord from "@salesforce/apex/Codify_ChangeLogConsoleController.countForRecord";
import getChangesForRecord from "@salesforce/apex/Codify_ChangeLogConsoleController.getChangesForRecord";

jest.mock(
  "@salesforce/apex/Codify_ChangeLogConsoleController.countForRecord",
  () => {
    const { createApexTestWireAdapter } = require("@salesforce/sfdx-lwc-jest");
    return { default: createApexTestWireAdapter(jest.fn()) };
  },
  { virtual: true }
);

jest.mock(
  "@salesforce/apex/Codify_ChangeLogConsoleController.getChangesForRecord",
  () => {
    const { createApexTestWireAdapter } = require("@salesforce/sfdx-lwc-jest");
    return { default: createApexTestWireAdapter(jest.fn()) };
  },
  { virtual: true }
);

const CHANGES = [
  {
    id: "a010000000000001",
    name: "CL-0001",
    changeType: "Case Field Update",
    fieldName: "Codify_Root_Cause__c",
    oldValue: "Unknown",
    newValue: "Firmware Out Of Date",
    relatedRecordName: "00001234",
    technicianName: "Dana Reeve",
    sourceResolutionLogId: "a020000000000001",
    sourceResolutionLogName: "RL-0001",
    requiresHumanReview: false,
    createdDate: "2026-01-07T10:15:00.000Z"
  },
  {
    id: "a010000000000002",
    name: "CL-0002",
    changeType: "Article Drafted",
    fieldName: null,
    oldValue: null,
    newValue: null,
    relatedRecordName: "Resetting a stalled controller",
    technicianName: "Dana Reeve",
    sourceResolutionLogId: "a020000000000001",
    sourceResolutionLogName: "RL-0001",
    requiresHumanReview: true,
    createdDate: "2026-01-07T10:16:00.000Z"
  }
];

function build() {
  const element = createElement("c-codify-case-history-badge", {
    is: CodifyCaseHistoryBadge
  });
  element.recordId = "5000000000000001";
  document.body.appendChild(element);
  return element;
}

describe("c-codify-case-history-badge", () => {
  afterEach(() => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
    jest.clearAllMocks();
  });

  it("holds the space with a placeholder while it checks", () => {
    const element = build();
    expect(
      element.shadowRoot.querySelector("c-codify-skeleton-loader")
    ).not.toBeNull();
  });

  it("renders nothing at all when Codify never touched the Case", async () => {
    const element = build();
    countForRecord.emit(0);
    getChangesForRecord.emit([]);
    await Promise.resolve();

    expect(element.shadowRoot.querySelector(".codify-note")).toBeNull();
    expect(element.shadowRoot.querySelector("c-codify-empty-state")).toBeNull();
  });

  it("states what Codify did, including that it drafted an article", async () => {
    const element = build();
    countForRecord.emit(2);
    getChangesForRecord.emit(CHANGES);
    await Promise.resolve();

    expect(
      element.shadowRoot.querySelector(".codify-note__headline").textContent
    ).toBe(
      "Codify logged this resolution and made 2 changes, and drafted a Knowledge article"
    );
  });

  it("calls out how much of it is still waiting on a person", async () => {
    const element = build();
    countForRecord.emit(2);
    getChangesForRecord.emit(CHANGES);
    await Promise.resolve();

    const labels = Array.from(
      element.shadowRoot.querySelectorAll("c-codify-status-badge")
    ).map((b) => b.label);
    expect(labels).toContain("Article drafted");
    expect(labels).toContain("1 awaiting review");
  });

  it("says so when nothing is awaiting review", async () => {
    const element = build();
    countForRecord.emit(1);
    getChangesForRecord.emit([CHANGES[0]]);
    await Promise.resolve();

    const labels = Array.from(
      element.shadowRoot.querySelectorAll("c-codify-status-badge")
    ).map((b) => b.label);
    expect(labels).not.toContain("Article drafted");
    expect(labels.some((l) => l.includes("awaiting review"))).toBe(false);
  });

  it("stays collapsed until asked, then reads as a timeline", async () => {
    const element = build();
    countForRecord.emit(2);
    getChangesForRecord.emit(CHANGES);
    await Promise.resolve();

    expect(element.shadowRoot.querySelector(".codify-thread")).toBeNull();

    const toggle = element.shadowRoot.querySelector("lightning-button");
    expect(toggle.label).toBe("Show what changed");
    toggle.click();
    await Promise.resolve();

    expect(
      element.shadowRoot.querySelectorAll(".codify-thread__item").length
    ).toBe(2);
    expect(
      element.shadowRoot.querySelector(".codify-thread__old").textContent
    ).toBe("Unknown");
    expect(
      element.shadowRoot.querySelector(".codify-thread__new").textContent
    ).toBe("Firmware Out Of Date");
  });

  it("reports a failure inline rather than silently showing nothing", async () => {
    const logged = jest.spyOn(console, "error").mockImplementation(() => {});
    const element = build();
    countForRecord.error({ message: "INSUFFICIENT_ACCESS" }, 403);
    await Promise.resolve();
    logged.mockRestore();

    const errorState = element.shadowRoot.querySelector("c-codify-error-state");
    expect(errorState).not.toBeNull();
    expect(errorState.detail).toContain("INSUFFICIENT_ACCESS");
  });
});
