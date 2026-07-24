import { LightningElement, wire } from "lwc";
import getRootCauseTrends from "@salesforce/apex/Codify_HomeDashboardController.getRootCauseTrends";

const COLUMNS = [
  { label: "Root cause", fieldName: "rootCause", type: "text", wrapText: true },
  {
    label: "Cases resolved",
    fieldName: "occurrences",
    type: "number",
    fixedWidth: 140
  },
  {
    label: "Articles drafted",
    fieldName: "articlesDrafted",
    type: "number",
    fixedWidth: 140
  },
  {
    label: "Related Cases flagged",
    fieldName: "relatedCasesFlagged",
    type: "number",
    fixedWidth: 180
  },
  {
    label: "Coverage",
    fieldName: "coverage",
    type: "text",
    fixedWidth: 130,
    cellAttributes: { class: { fieldName: "coverageClass" } }
  },
  {
    label: "Last seen",
    fieldName: "lastSeen",
    type: "date",
    typeAttributes: { year: "numeric", month: "short", day: "numeric" }
  }
];

const WINDOW_OPTIONS = [
  { label: "Last 30 days", value: "30" },
  { label: "Last 90 days", value: "90" },
  { label: "Last 180 days", value: "180" },
  { label: "Last 365 days", value: "365" }
];

/**
 * Which root causes keep coming back, and whether the knowledge base has caught
 * up with them. The coverage column is the point of this tab: a cause that
 * recurs often with no article behind it is exactly the documentation gap
 * Codify exists to close, so it is called out rather than left to be inferred
 * from two number columns.
 */
export default class CodifyRootCauseTrends extends LightningElement {
  columns = COLUMNS;
  windowOptions = WINDOW_OPTIONS;
  daysBack = "90";
  rows = [];
  error;

  @wire(getRootCauseTrends, { daysBack: "$daysBackNumber" })
  wiredTrends({ data, error }) {
    if (data) {
      this.rows = data.map((t) => this.decorate(t));
      this.error = undefined;
    } else if (error) {
      this.error = this.reduceError(error);
      this.rows = [];
    }
  }

  decorate(t) {
    let coverage = "Documented";
    let coverageClass = "slds-text-color_success";
    if (t.articlesDrafted === 0) {
      coverage = t.occurrences > 1 ? "Gap" : "Not yet";
      coverageClass =
        t.occurrences > 1 ? "slds-text-color_error" : "slds-text-color_weak";
    } else if (t.occurrences > t.articlesDrafted * 3) {
      coverage = "Thin";
      coverageClass = "slds-text-color_weak";
    }
    return { ...t, coverage, coverageClass };
  }

  get daysBackNumber() {
    return parseInt(this.daysBack, 10);
  }

  handleWindow(e) {
    this.daysBack = e.detail.value;
  }

  get hasRows() {
    return this.rows.length > 0;
  }

  /** Recurring causes with nothing written up: the actionable subset. */
  get gapCount() {
    return this.rows.filter((r) => r.coverage === "Gap").length;
  }

  get gapLabel() {
    const n = this.gapCount;
    if (n === 0) {
      return "Every recurring root cause has at least one article behind it.";
    }
    return `${n} recurring root cause${n === 1 ? " has" : "s have"} no Knowledge article yet.`;
  }

  get gapClass() {
    return this.gapCount === 0
      ? "slds-text-body_small slds-text-color_success"
      : "slds-text-body_small slds-text-color_error";
  }

  reduceError(error) {
    return error?.body?.message || error?.message || "Unknown error";
  }
}
