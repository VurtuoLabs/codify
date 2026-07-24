import { LightningElement, api, wire } from "lwc";
import { NavigationMixin } from "lightning/navigation";
import countForRecord from "@salesforce/apex/Codify_ChangeLogConsoleController.countForRecord";
import getChangesForRecord from "@salesforce/apex/Codify_ChangeLogConsoleController.getChangesForRecord";

export default class CodifyCaseHistoryBadge extends NavigationMixin(
  LightningElement
) {
  @api recordId;
  count = 0;
  expanded = false;
  rows = [];
  draftedArticle = false;

  @wire(countForRecord, { recordId: "$recordId" })
  wiredCount({ data }) {
    if (data !== undefined && data !== null) {
      this.count = data;
    }
  }

  @wire(getChangesForRecord, { recordId: "$recordId" })
  wiredRows({ data }) {
    if (data) {
      this.rows = data.map((r) => ({
        id: r.id,
        title: this.describe(r),
        meta: `${r.technicianName || "Codify"} · ${new Date(r.createdDate).toLocaleDateString()}`,
        recapId: r.sourceResolutionLogId,
        needsReview: r.requiresHumanReview
      }));
      this.draftedArticle = data.some(
        (r) => r.changeType === "Article Drafted"
      );
    }
  }

  describe(r) {
    if (
      r.changeType === "Case Field Update" ||
      r.changeType === "Root Cause Tagged"
    ) {
      return `${r.fieldName}: "${r.oldValue || "(blank)"}" → "${r.newValue || ""}"`;
    }
    return `${r.changeType}: ${r.relatedRecordName || ""}`;
  }

  get hasChanges() {
    return this.count > 0;
  }

  /**
   * The headline states what Codify actually did on this Case. Whether an
   * article was drafted is called out separately, because "drafted" is the
   * thing a Case owner most needs to know is still pending someone's review.
   */
  get badgeLabel() {
    const changes = `Codify logged this resolution and made ${this.count} change${this.count === 1 ? "" : "s"}`;
    return this.draftedArticle
      ? `${changes}, and drafted a Knowledge article`
      : changes;
  }

  get toggleLabel() {
    return this.expanded ? "Hide" : "Show";
  }

  toggle() {
    this.expanded = !this.expanded;
  }

  openRecap(event) {
    const recapId = event.currentTarget.dataset.id;
    if (recapId) {
      this[NavigationMixin.Navigate]({
        type: "standard__recordPage",
        attributes: { recordId: recapId, actionName: "view" }
      });
    }
  }
}
