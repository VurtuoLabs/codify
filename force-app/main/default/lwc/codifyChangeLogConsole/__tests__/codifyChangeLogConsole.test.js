import { createElement } from "lwc";
import CodifyChangeLogConsole from "c/codifyChangeLogConsole";
import getChanges from "@salesforce/apex/Codify_ChangeLogConsoleController.getChanges";
import getFilterOptions from "@salesforce/apex/Codify_ChangeLogConsoleController.getFilterOptions";

// getChanges is called imperatively so the six server-side filters can be
// re-applied on demand; getFilterOptions is wired.
jest.mock(
  "@salesforce/apex/Codify_ChangeLogConsoleController.getChanges",
  () => ({ default: jest.fn() }),
  { virtual: true }
);

jest.mock(
  "@salesforce/apex/Codify_ChangeLogConsoleController.getFilterOptions",
  () => {
    const { createApexTestWireAdapter } = require("@salesforce/sfdx-lwc-jest");
    return { default: createApexTestWireAdapter(jest.fn()) };
  },
  { virtual: true }
);

function row(overrides = {}) {
  return {
    id: "a010000000000001",
    name: "CL-0001",
    changeType: "Case Field Update",
    objectApiName: "Case",
    relatedRecordId: "5000000000000001",
    relatedRecordName: "00001234",
    fieldName: "Codify_Root_Cause__c",
    oldValue: "Unknown",
    newValue: "Firmware Out Of Date",
    technicianName: "Dana Reeve",
    sourceResolutionLogId: "a020000000000001",
    sourceResolutionLogName: "RL-0001",
    rootCause: "Firmware Out Of Date",
    requiresHumanReview: false,
    createdDate: "2026-01-07T10:15:00.000Z",
    ...overrides
  };
}

const ROWS = [
  row(),
  row({
    id: "a010000000000002",
    name: "CL-0002",
    changeType: "Article Drafted",
    objectApiName: "Knowledge__kav",
    relatedRecordName: "Resetting a stalled controller",
    fieldName: null,
    oldValue: null,
    newValue: null,
    technicianName: "Ali Novak",
    requiresHumanReview: true,
    createdDate: "2026-01-08T10:15:00.000Z"
  })
];

// Lets the imperative Apex promise chain and the resulting rerender settle.
function flush() {
  return new Promise(process.nextTick);
}

function build() {
  const element = createElement("c-codify-change-log-console", {
    is: CodifyChangeLogConsole
  });
  document.body.appendChild(element);
  return element;
}

describe("c-codify-change-log-console", () => {
  afterEach(() => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
    jest.clearAllMocks();
  });

  it("shows skeleton rows, not an empty table, while loading", () => {
    getChanges.mockResolvedValue(ROWS);
    const element = build();
    expect(
      element.shadowRoot.querySelector("c-codify-skeleton-loader")
    ).not.toBeNull();
    expect(element.shadowRoot.querySelector(".codify-table")).toBeNull();
  });

  it("asks Apex for the six server-side filters and the row cap", async () => {
    getChanges.mockResolvedValue(ROWS);
    build();
    await flush();

    expect(getChanges).toHaveBeenCalledWith({
      technicianId: null,
      caseId: null,
      rootCause: null,
      changeType: null,
      startDate: null,
      endDate: null,
      maxRows: 200
    });
  });

  it("renders one table row per change with a semantic header", async () => {
    getChanges.mockResolvedValue(ROWS);
    const element = build();
    await flush();

    expect(element.shadowRoot.querySelectorAll("tbody tr").length).toBe(2);
    const headers = element.shadowRoot.querySelectorAll('th[scope="col"]');
    expect(headers.length).toBe(10);
  });

  it("renders the before and after values as a diff", async () => {
    getChanges.mockResolvedValue([row()]);
    const element = build();
    await flush();

    expect(
      element.shadowRoot.querySelector(".codify-diff__old").textContent
    ).toBe("Unknown");
    expect(
      element.shadowRoot.querySelector(".codify-diff__new").textContent
    ).toBe("Firmware Out Of Date");
  });

  it("pairs the review state with a label rather than a colour", async () => {
    getChanges.mockResolvedValue(ROWS);
    const element = build();
    await flush();

    const labels = Array.from(
      element.shadowRoot.querySelectorAll("c-codify-status-badge")
    ).map((b) => b.label);
    expect(labels).toContain("Needs review");
    expect(labels).toContain("No review needed");
  });

  it("sorts on a column header and reverses on a second click", async () => {
    getChanges.mockResolvedValue(ROWS);
    const element = build();
    await flush();

    const technicianHeader = element.shadowRoot.querySelector(
      '[data-field="technicianName"]'
    );
    technicianHeader.click();
    await Promise.resolve();

    let names = Array.from(
      element.shadowRoot.querySelectorAll('[data-label="Technician"]')
    ).map((n) => n.textContent.trim());
    expect(names[0]).toBe("Ali Novak");

    technicianHeader.click();
    await Promise.resolve();

    names = Array.from(
      element.shadowRoot.querySelectorAll('[data-label="Technician"]')
    ).map((n) => n.textContent.trim());
    expect(names[0]).toBe("Dana Reeve");
  });

  it("narrows the fetched page with the search box", async () => {
    getChanges.mockResolvedValue(ROWS);
    const element = build();
    await flush();

    // The search box is the first input in the filter bar.
    const searchInput =
      element.shadowRoot.querySelectorAll("lightning-input")[0];
    searchInput.value = "stalled controller";
    searchInput.dispatchEvent(new CustomEvent("change"));
    await Promise.resolve();

    expect(element.shadowRoot.querySelectorAll("tbody tr").length).toBe(1);
  });

  it("expands a row to show values the cells clamp", async () => {
    getChanges.mockResolvedValue([row()]);
    const element = build();
    await flush();

    expect(element.shadowRoot.querySelector(".codify-detail")).toBeNull();

    element.shadowRoot.querySelector("lightning-button-icon").click();
    await Promise.resolve();

    const detail = element.shadowRoot.querySelector(".codify-detail");
    expect(detail).not.toBeNull();
    expect(detail.textContent).toContain("Firmware Out Of Date");
  });

  it("pages rather than rendering every fetched row at once", async () => {
    const many = Array.from({ length: 30 }, (unused, i) =>
      row({
        id: `a01000000000${i.toString().padStart(4, "0")}`,
        name: `CL-${i}`
      })
    );
    getChanges.mockResolvedValue(many);
    const element = build();
    await flush();

    expect(element.shadowRoot.querySelectorAll("tbody tr").length).toBe(25);
    expect(
      element.shadowRoot.querySelector(".codify-paging__label").textContent
    ).toBe("Page 1 of 2");

    const next = element.shadowRoot.querySelectorAll(
      ".codify-paging lightning-button-icon"
    )[1];
    next.click();
    await Promise.resolve();

    expect(element.shadowRoot.querySelectorAll("tbody tr").length).toBe(5);
  });

  it("distinguishes a filtered empty result from a system that has done nothing", async () => {
    getChanges.mockResolvedValue([]);
    const element = build();
    await flush();

    let empty = element.shadowRoot.querySelector("c-codify-empty-state");
    expect(empty.title).toBe("Codify has not changed anything yet");
    expect(empty.actionLabel).toBeUndefined();

    const comboboxes =
      element.shadowRoot.querySelectorAll("lightning-combobox");
    comboboxes[0].dispatchEvent(
      new CustomEvent("change", { detail: { value: "005000000000001" } })
    );
    await flush();

    empty = element.shadowRoot.querySelector("c-codify-empty-state");
    expect(empty.title).toBe("No changes match these filters");
    expect(empty.actionLabel).toBe("Clear all filters");
  });

  it("keeps the table usable when the filter option query fails", async () => {
    const logged = jest.spyOn(console, "error").mockImplementation(() => {});
    getChanges.mockResolvedValue(ROWS);
    const element = build();
    getFilterOptions.error({ message: "OPTIONS_UNAVAILABLE" }, 500);
    await flush();
    logged.mockRestore();

    expect(element.shadowRoot.querySelectorAll("tbody tr").length).toBe(2);
    expect(
      element.shadowRoot.querySelector(".codify-filterbar__warning")
    ).not.toBeNull();
  });

  it("translates a failed query into a retryable error state", async () => {
    const logged = jest.spyOn(console, "error").mockImplementation(() => {});
    getChanges.mockRejectedValue({
      body: { message: "INSUFFICIENT_ACCESS_OR_READONLY" }
    });
    const element = build();
    await flush();
    logged.mockRestore();

    const errorState = element.shadowRoot.querySelector("c-codify-error-state");
    expect(errorState).not.toBeNull();
    expect(errorState.message).toContain("permission set");
    expect(errorState.detail).toBe("INSUFFICIENT_ACCESS_OR_READONLY");
  });
});
