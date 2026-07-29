import { LightningElement, api, wire } from "lwc";
import { NavigationMixin } from "lightning/navigation";
import countForRecord from "@salesforce/apex/Codify_ChangeLogConsoleController.countForRecord";
import getChangesForRecord from "@salesforce/apex/Codify_ChangeLogConsoleController.getChangesForRecord";
import {
  changeMeta,
  describeChange,
  reduceApexError,
  logError,
  pluralise
} from "c/codifyDisplay";

/**
 * The annotation on the Case page: Codify was here, this is what it did, and
 * here is the recap it did it from.
 *
 * Two design decisions worth stating. First, when Codify has touched nothing the
 * component renders nothing at all - a Case page should not carry an empty card
 * explaining an absence. Second, while the counts are loading it draws a
 * placeholder the same height as the collapsed strip, so the common case (Codify
 * did touch this Case) resolves with no layout shift. The rarer case - no
 * changes - does collapse away, which is the right trade: a permanent empty card
 * on every Case page would be worse than one small settle on a few of them.
 *
 * Expanded, the changes read as an activity timeline with before/after values,
 * because "what changed on my Case, in what order, and why" is the question a
 * Case owner actually has.
 */
export default class CodifyCaseHistoryBadge extends NavigationMixin(
  LightningElement
) {
  @api recordId;

  count = 0;
  rows = [];
  expanded = false;
  draftedArticle = false;
  pendingReviewCount = 0;

  countLoaded = false;
  rowsLoaded = false;
  error;

  @wire(countForRecord, { recordId: "$recordId" })
  wiredCount({ data, error }) {
    if (data !== undefined && data !== null) {
      this.count = data;
      this.countLoaded = true;
    } else if (error) {
      logError("Case badge count", error);
      this.error = reduceApexError(
        error,
        "Codify could not read this Case's history."
      );
      this.countLoaded = true;
    }
  }

  @wire(getChangesForRecord, { recordId: "$recordId" })
  wiredRows({ data, error }) {
    if (data) {
      this.rows = data.map((r) => {
        const meta = changeMeta(r.changeType);
        return {
          id: r.id,
          title: describeChange(r),
          type: r.changeType,
          icon: meta.icon,
          tone: meta.tone,
          who: r.technicianName || "Codify",
          createdDate: r.createdDate,
          needsReview: r.requiresHumanReview === true,
          hasDiff: Boolean(r.oldValue),
          oldValue: r.oldValue,
          newValue: r.newValue,
          recapId: r.sourceResolutionLogId,
          recapName: r.sourceResolutionLogName || "source recap"
        };
      });
      this.draftedArticle = data.some(
        (r) => r.changeType === "Article Drafted"
      );
      this.pendingReviewCount = data.filter(
        (r) => r.requiresHumanReview === true
      ).length;
      this.rowsLoaded = true;
    } else if (error) {
      logError("Case badge changes", error);
      this.error = reduceApexError(
        error,
        "Codify could not read this Case's history."
      );
      this.rowsLoaded = true;
    }
  }

  get isLoading() {
    return !this.countLoaded && !this.error;
  }

  get hasChanges() {
    return this.count > 0;
  }

  get isRowsLoading() {
    return !this.rowsLoaded && !this.error;
  }

  /** Nothing to say, and no empty card saying so. */
  get isSilent() {
    return this.countLoaded && this.count === 0 && !this.error;
  }

  /**
   * The headline states what Codify actually did. Whether an article was drafted
   * is called out separately, because "drafted" is the thing a Case owner most
   * needs to know is still pending someone's review.
   */
  get badgeLabel() {
    const changes = `Codify logged this resolution and made ${pluralise(
      this.count,
      "change"
    )}`;
    return this.draftedArticle
      ? `${changes}, and drafted a Knowledge article`
      : changes;
  }

  get statusBadges() {
    const badges = [];
    if (this.draftedArticle) {
      badges.push({
        key: "drafted",
        label: "Article drafted",
        tone: "info",
        icon: "utility:knowledge_base"
      });
    }
    if (this.pendingReviewCount > 0) {
      badges.push({
        key: "review",
        label: `${this.pendingReviewCount} awaiting review`,
        tone: "pending",
        icon: "utility:clock"
      });
    }
    if (this.draftedArticle && this.pendingReviewCount === 0) {
      badges.push({
        key: "clear",
        label: "Nothing awaiting review",
        tone: "success",
        icon: "utility:check"
      });
    }
    return badges;
  }

  get toggleLabel() {
    return this.expanded ? "Hide the detail" : "Show what changed";
  }

  get expandedString() {
    return String(this.expanded);
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
