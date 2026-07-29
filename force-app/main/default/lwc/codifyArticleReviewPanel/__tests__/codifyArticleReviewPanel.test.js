import { createElement } from "lwc";
import CodifyArticleReviewPanel from "c/codifyArticleReviewPanel";
import getPendingArticles from "@salesforce/apex/Codify_ArticleReviewController.getPendingArticles";
import saveDraft from "@salesforce/apex/Codify_ArticleReviewController.saveDraft";
import rejectDraft from "@salesforce/apex/Codify_ArticleReviewController.rejectDraft";

jest.mock(
  "@salesforce/apex/Codify_ArticleReviewController.getPendingArticles",
  () => {
    const { createApexTestWireAdapter } = require("@salesforce/sfdx-lwc-jest");
    return { default: createApexTestWireAdapter(jest.fn()) };
  },
  { virtual: true }
);

jest.mock(
  "@salesforce/apex/Codify_ArticleReviewController.saveDraft",
  () => ({ default: jest.fn() }),
  { virtual: true }
);

jest.mock(
  "@salesforce/apex/Codify_ArticleReviewController.rejectDraft",
  () => ({ default: jest.fn() }),
  { virtual: true }
);

const DRAFTS = [
  {
    id: "ka0000000000001",
    title: "Resetting a stalled controller",
    summary: "Power cycle the controller after a firmware mismatch.",
    body: "<p>Step one…</p>",
    rootCause: "Firmware Out Of Date",
    originalRecap: "Found the firmware two versions behind.\nFlashed it.",
    sourceCaseId: "5000000000000001",
    sourceCaseNumber: "00001234",
    sourceResolutionLogId: "a020000000000001",
    sourceResolutionLogName: "RL-0001",
    technicianName: "Dana Reeve",
    publishStatus: "Draft",
    lastModified: "2026-01-07T10:15:00.000Z"
  },
  {
    id: "ka0000000000002",
    title: "Reseating a loose sensor harness",
    summary: null,
    body: "<p>Step one…</p>",
    rootCause: "Incorrect Installation",
    originalRecap: "The harness was not clipped in.",
    sourceCaseId: null,
    sourceCaseNumber: null,
    sourceResolutionLogId: null,
    sourceResolutionLogName: null,
    technicianName: null,
    publishStatus: "Draft",
    lastModified: "2026-01-06T10:15:00.000Z"
  }
];

// Lets the imperative Apex promise chain and the resulting rerender settle.
function flush() {
  return new Promise(process.nextTick);
}

function build() {
  const element = createElement("c-codify-article-review-panel", {
    is: CodifyArticleReviewPanel
  });
  document.body.appendChild(element);
  return element;
}

function buttonByLabel(element, label) {
  return Array.from(
    element.shadowRoot.querySelectorAll("lightning-button")
  ).find((b) => b.label === label);
}

describe("c-codify-article-review-panel", () => {
  afterEach(() => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
    jest.clearAllMocks();
  });

  it("shows skeletons for all three surfaces on first load", () => {
    const element = build();
    expect(
      element.shadowRoot.querySelectorAll("c-codify-skeleton-loader").length
    ).toBe(3);
  });

  it("selects the first draft and sets it as a manuscript", async () => {
    const element = build();
    getPendingArticles.emit(DRAFTS);
    await Promise.resolve();

    expect(
      element.shadowRoot.querySelector(".codify-ms__title").textContent
    ).toBe("Resetting a stalled controller");
    expect(
      element.shadowRoot.querySelector(".codify-ms__lede").textContent
    ).toBe("Power cycle the controller after a firmware mismatch.");
    expect(
      element.shadowRoot.querySelector(".codify-ms__stamp").textContent
    ).toBe("Draft 1 of 2");
  });

  it("shows the verbatim recap beside the draft", async () => {
    const element = build();
    getPendingArticles.emit(DRAFTS);
    await Promise.resolve();

    const recap = element.shadowRoot.querySelector(".codify-recap");
    expect(recap.textContent).toContain("firmware two versions behind");
  });

  it("warns when there is no recap to compare the draft against", async () => {
    const element = build();
    getPendingArticles.emit([{ ...DRAFTS[0], originalRecap: null }]);
    await Promise.resolve();

    expect(element.shadowRoot.querySelector(".codify-recap")).toBeNull();
    expect(
      element.shadowRoot.querySelector(".codify-source__none").textContent
    ).toContain("nothing to compare");
  });

  it("shows the lifecycle with publishing outside Codify", async () => {
    const element = build();
    getPendingArticles.emit(DRAFTS);
    await Promise.resolve();

    const indicator = element.shadowRoot.querySelector(
      "lightning-progress-indicator"
    );
    expect(indicator.currentStep).toBe("review");
    const steps = element.shadowRoot.querySelectorAll(
      "lightning-progress-step"
    );
    expect(steps.length).toBe(4);
    expect(steps[3].label).toBe("Published in Knowledge");
  });

  it("never offers a publish action", async () => {
    const element = build();
    getPendingArticles.emit(DRAFTS);
    await Promise.resolve();

    const labels = Array.from(
      element.shadowRoot.querySelectorAll("lightning-button")
    ).map((b) => (b.label || "").toLowerCase());
    expect(labels.some((l) => l.includes("publish"))).toBe(false);
  });

  it("reads by default and edits only when asked", async () => {
    const element = build();
    getPendingArticles.emit(DRAFTS);
    await Promise.resolve();

    expect(element.shadowRoot.querySelector("lightning-input")).toBeNull();

    buttonByLabel(element, "Edit draft").click();
    await Promise.resolve();

    expect(element.shadowRoot.querySelector(".codify-ms__paper")).toBeNull();
    expect(
      element.shadowRoot.querySelector('lightning-input[data-id="draft-title"]')
    ).not.toBeNull();
  });

  it("keeps Save disabled until something actually changed", async () => {
    const element = build();
    getPendingArticles.emit(DRAFTS);
    await Promise.resolve();
    buttonByLabel(element, "Edit draft").click();
    await Promise.resolve();

    expect(buttonByLabel(element, "Save draft").disabled).toBe(true);

    const title = element.shadowRoot.querySelector(
      'lightning-input[data-id="draft-title"]'
    );
    title.value = "A better title";
    title.dispatchEvent(new CustomEvent("change"));
    await Promise.resolve();

    expect(buttonByLabel(element, "Save draft").disabled).toBe(false);
  });

  it("refuses to save an untitled article and says why, next to the field", async () => {
    const element = build();
    getPendingArticles.emit(DRAFTS);
    await Promise.resolve();
    buttonByLabel(element, "Edit draft").click();
    await Promise.resolve();

    const title = element.shadowRoot.querySelector(
      'lightning-input[data-id="draft-title"]'
    );
    title.value = "   ";
    title.dispatchEvent(new CustomEvent("change"));
    await Promise.resolve();

    buttonByLabel(element, "Save draft").click();
    await flush();

    expect(saveDraft).not.toHaveBeenCalled();
    expect(
      element.shadowRoot.querySelector(".codify-editor__error").textContent
    ).toContain("needs a title");
  });

  it("saves the reviewer's edits and returns to reading", async () => {
    saveDraft.mockResolvedValue("Saved. The article is still in Draft.");
    const element = build();
    getPendingArticles.emit(DRAFTS);
    await Promise.resolve();
    buttonByLabel(element, "Edit draft").click();
    await Promise.resolve();

    const title = element.shadowRoot.querySelector(
      'lightning-input[data-id="draft-title"]'
    );
    title.value = "Resetting a stalled controller (revised)";
    title.dispatchEvent(new CustomEvent("change"));
    await Promise.resolve();

    buttonByLabel(element, "Save draft").click();
    await flush();

    expect(saveDraft).toHaveBeenCalledWith({
      articleId: "ka0000000000001",
      title: "Resetting a stalled controller (revised)",
      summary: "Power cycle the controller after a firmware mismatch.",
      body: "<p>Step one…</p>"
    });
    expect(
      element.shadowRoot.querySelector(".codify-controls__saved").textContent
    ).toContain("still in Draft");
  });

  it("asks before rejecting, and only deletes on confirmation", async () => {
    rejectDraft.mockResolvedValue("Draft rejected and removed.");
    const element = build();
    getPendingArticles.emit(DRAFTS);
    await Promise.resolve();

    expect(element.shadowRoot.querySelector('[role="dialog"]')).toBeNull();

    buttonByLabel(element, "Reject draft…").click();
    await Promise.resolve();

    const dialog = element.shadowRoot.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(rejectDraft).not.toHaveBeenCalled();

    const reason = element.shadowRoot.querySelector(
      '[data-id="reject-reason"]'
    );
    reason.value = "Duplicates an existing article";
    reason.dispatchEvent(new CustomEvent("change"));
    await Promise.resolve();

    buttonByLabel(element, "Reject and delete the draft").click();
    await flush();

    expect(rejectDraft).toHaveBeenCalledWith({
      articleId: "ka0000000000001",
      reason: "Duplicates an existing article"
    });
  });

  it("lets the reviewer back out of a rejection", async () => {
    const element = build();
    getPendingArticles.emit(DRAFTS);
    await Promise.resolve();

    buttonByLabel(element, "Reject draft…").click();
    await Promise.resolve();
    buttonByLabel(element, "Keep the draft").click();
    await Promise.resolve();

    expect(element.shadowRoot.querySelector('[role="dialog"]')).toBeNull();
    expect(rejectDraft).not.toHaveBeenCalled();
  });

  it("switches drafts from the queue", async () => {
    const element = build();
    getPendingArticles.emit(DRAFTS);
    await Promise.resolve();

    const items = element.shadowRoot.querySelectorAll(".codify-queue__item");
    expect(items.length).toBe(2);
    expect(items[0].getAttribute("aria-current")).toBe("true");

    items[1].click();
    await Promise.resolve();

    expect(
      element.shadowRoot.querySelector(".codify-ms__title").textContent
    ).toBe("Reseating a loose sensor harness");
  });

  it("celebrates an empty queue instead of showing a blank card", async () => {
    const element = build();
    getPendingArticles.emit([]);
    await Promise.resolve();

    const empty = element.shadowRoot.querySelector("c-codify-empty-state");
    expect(empty.title).toBe("No drafts are waiting for review");
    expect(empty.size).toBe("page");
  });

  it("offers a retry when the queue cannot be read", async () => {
    const logged = jest.spyOn(console, "error").mockImplementation(() => {});
    const element = build();
    getPendingArticles.error({ message: "KNOWLEDGE_DISABLED" }, 500);
    await Promise.resolve();
    logged.mockRestore();

    const errorState = element.shadowRoot.querySelector("c-codify-error-state");
    expect(errorState.showRetry).toBe(true);
    expect(errorState.detail).toContain("KNOWLEDGE_DISABLED");
  });
});
