import { LightningElement, wire } from "lwc";
import getSummary from "@salesforce/apex/Codify_HomeDashboardController.getSummary";

export default class CodifyHomeDashboard extends LightningElement {
  summary;
  error;

  @wire(getSummary)
  wiredSummary({ data, error }) {
    if (data) {
      this.summary = data;
      this.error = undefined;
    } else if (error) {
      this.error = this.reduceError(error);
    }
  }

  get resolutionsThisWeek() {
    return this.summary ? this.summary.resolutionsThisWeek : 0;
  }

  get articlesDrafted() {
    return this.summary ? this.summary.articlesDrafted : 0;
  }

  get articlesPending() {
    return this.summary ? this.summary.articlesPending : 0;
  }

  get casesFlagged() {
    return this.summary ? this.summary.casesFlagged : 0;
  }

  get escalations() {
    return this.summary ? this.summary.escalations : 0;
  }

  get topRootCauses() {
    return this.summary?.topRootCauses || [];
  }

  get topTechnicians() {
    return this.summary?.topTechnicians || [];
  }

  get byChangeType() {
    return this.summary?.byChangeType || [];
  }

  /**
   * Escalations are surfaced as a normal tile, not hidden or styled as a
   * failure. Codify declining to classify is a designed outcome, and a week
   * with zero escalations would more likely mean the confidence floor is too
   * low than that everything went perfectly.
   */
  get escalationHint() {
    return this.escalations === 0
      ? "none this week"
      : "recaps routed to a human instead of guessed";
  }

  // Trend rows with a bar width (%) relative to the busiest day.
  get trend() {
    const raw = this.summary?.trend || [];
    const max = raw.reduce((m, t) => Math.max(m, t.count), 0) || 1;
    return raw.map((t, i) => ({
      key: `${t.label}-${i}`,
      label: t.label,
      count: t.count,
      style: `width:${Math.round((t.count / max) * 100)}%`
    }));
  }

  get hasRootCauses() {
    return this.topRootCauses.length > 0;
  }

  get hasTechnicians() {
    return this.topTechnicians.length > 0;
  }

  reduceError(error) {
    return error?.body?.message || error?.message || "Unknown error";
  }
}
