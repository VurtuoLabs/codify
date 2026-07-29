import { LightningElement, wire } from "lwc";
import { NavigationMixin } from "lightning/navigation";
import { refreshApex } from "@salesforce/apex";
import { ShowToastEvent } from "lightning/platformShowToastEvent";
import getSummary from "@salesforce/apex/Codify_HomeDashboardController.getSummary";
import getChanges from "@salesforce/apex/Codify_ChangeLogConsoleController.getChanges";
import {
  changeMeta,
  describeChange,
  reduceApexError,
  logError,
  pluralise
} from "c/codifyDisplay";

/**
 * Codify Home - the review desk.
 *
 * The page is ordered by what a Knowledge owner has to decide, not by what the
 * controller happens to return. One question outranks every other: what is
 * waiting on a person right now? Drafts sit in Draft until a human approves
 * them, and a recap Codify refused to classify goes nowhere until a human names
 * the cause - so that is the hero figure, in the first band, with the button
 * that opens the queue beside it.
 *
 * Everything below is context for that decision: how far recaps travelled (the
 * pipeline), whether capture is happening at all (cadence), what keeps breaking,
 * who is capturing, and the last few audited actions.
 *
 * The activity timeline reuses the change log console's existing cacheable
 * query rather than adding an Apex method, so no server behaviour changed.
 */
const ACTIVITY_ROWS = 8;

export default class CodifyHomeDashboard extends NavigationMixin(
  LightningElement
) {
  summary;
  summaryError;
  activity = [];
  activityError;

  isRefreshing = false;
  lastRefreshed;

  analysisExpanded = true;
  activityExpanded = true;

  summaryResult;
  activityResult;

  @wire(getSummary)
  wiredSummary(result) {
    this.summaryResult = result;
    const { data, error } = result;
    if (data) {
      this.summary = data;
      this.summaryError = undefined;
      this.lastRefreshed = new Date();
    } else if (error) {
      logError("Home dashboard summary", error);
      this.summaryError = reduceApexError(
        error,
        "Codify could not read the summary figures."
      );
    }
  }

  @wire(getChanges, {
    technicianId: null,
    caseId: null,
    rootCause: null,
    changeType: null,
    startDate: null,
    endDate: null,
    maxRows: ACTIVITY_ROWS
  })
  wiredActivity(result) {
    this.activityResult = result;
    const { data, error } = result;
    if (data) {
      this.activity = data.map((row) => {
        const meta = changeMeta(row.changeType);
        return {
          id: row.id,
          title: describeChange(row),
          type: row.changeType,
          icon: meta.icon,
          tone: meta.tone,
          technician: row.technicianName || "Codify",
          createdDate: row.createdDate,
          needsReview: row.requiresHumanReview === true,
          recordId: row.relatedRecordId
        };
      });
      this.activityError = undefined;
    } else if (error) {
      logError("Home dashboard activity", error);
      this.activityError = reduceApexError(
        error,
        "Codify could not read the audit trail."
      );
    }
  }

  // ── Load state ──────────────────────────────────────────────────────────
  get isLoading() {
    return !this.summary && !this.summaryError;
  }

  get isActivityLoading() {
    return !this.activity.length && !this.activityError && !this.activityLoaded;
  }

  get activityLoaded() {
    return Boolean(this.activityResult && this.activityResult.data);
  }

  get hasActivity() {
    return this.activity.length > 0;
  }

  get s() {
    return this.summary || {};
  }

  get refreshLabel() {
    return this.isRefreshing ? "Refreshing…" : "Refresh";
  }

  get lastRefreshedLabel() {
    if (this.isLoading) {
      return "Loading figures…";
    }
    if (!this.lastRefreshed) {
      return "";
    }
    return `Figures as at ${this.lastRefreshed.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    })}`;
  }

  // ── The decision: what is waiting on a person ───────────────────────────
  get described() {
    return this.s.resolutionsAllTime || 0;
  }

  get tagged() {
    return this.s.resolutionsTagged || 0;
  }

  get untagged() {
    return this.s.resolutionsUntagged || 0;
  }

  get pending() {
    return this.s.articlesPending || 0;
  }

  get published() {
    return this.s.articlesPublished || 0;
  }

  /** Derived from Knowledge, so it always agrees with pending + published. */
  get drafted() {
    return this.pending + this.published;
  }

  get escalations() {
    return this.s.escalations || 0;
  }

  get casesFlagged() {
    return this.s.casesFlagged || 0;
  }

  get waitingTotal() {
    return this.pending + this.untagged + this.escalations;
  }

  get pendingProgress() {
    return this.drafted > 0 ? (this.pending / this.drafted) * 100 : 0;
  }

  get pendingSupportingText() {
    return this.pending === 0
      ? "Nothing is waiting on a reviewer. Every draft Codify wrote has been actioned."
      : `Not live until a person approves them - ${this.pending} of ${this.drafted} drafts Codify has written.`;
  }

  get untaggedSupportingText() {
    return this.untagged === 0
      ? "Every recap was corroborated well enough to classify."
      : "Refused rather than guessed at. A person naming the cause always beats the classifier.";
  }

  get escalationSupportingText() {
    return this.escalations === 0
      ? "No recap was too thin to classify this week."
      : "Each one created a Task carrying the verbatim recap.";
  }

  get waitingBadgeTone() {
    return this.waitingTotal === 0 ? "success" : "pending";
  }

  get waitingBadgeLabel() {
    return this.waitingTotal === 0
      ? "Nothing waiting on a person"
      : `${this.waitingTotal} waiting on a person`;
  }

  get reviewButtonVariant() {
    return this.pending > 0 ? "brand" : "neutral";
  }

  // ── The pipeline: how far a recap travelled ─────────────────────────────
  get pipelineStages() {
    const total = this.described;
    const stage = (key, label, count, note, tone) => {
      const pct = total > 0 ? Math.round((count / total) * 100) : 0;
      return {
        key,
        label,
        count,
        note,
        barClass: `codify-stage__bar codify-stage__bar_${tone}`,
        // A non-zero stage always shows a sliver rather than an empty track.
        style: `width:${total > 0 ? Math.min(Math.max(pct, count > 0 ? 2 : 0), 100) : 0}%`,
        percentLabel: total > 0 ? `${pct}%` : "-",
        srLabel: `${label}: ${count}${total > 0 ? `, ${pct}% of fixes described` : ""}`
      };
    };

    return [
      stage(
        "described",
        "Fixes described",
        total,
        `${pluralise(this.s.resolutionsThisWeek || 0, "fix")} this week`,
        "ink"
      ),
      stage(
        "tagged",
        "Root cause tagged",
        this.tagged,
        this.untagged > 0
          ? `${this.untagged} left unclassified on purpose`
          : "every recap classified",
        "accent"
      ),
      stage(
        "drafted",
        "Article drafted",
        this.drafted,
        total - this.drafted > 0
          ? `${total - this.drafted} fixes did not warrant one`
          : "every fix warranted one",
        "accent-soft"
      ),
      stage(
        "published",
        "Published to Knowledge",
        this.published,
        this.pending > 0
          ? `${this.pending} still with a reviewer`
          : "nothing with a reviewer",
        "good"
      )
    ];
  }

  get coveragePercent() {
    return this.described > 0
      ? Math.round((this.published / this.described) * 100)
      : 0;
  }

  /** Donut arc length, against a circle drawn with a 100-unit circumference. */
  get coverageDashStyle() {
    const pct = Math.min(Math.max(this.coveragePercent, 0), 100);
    return `stroke-dasharray:${pct} ${100 - pct}`;
  }

  get coverageNote() {
    return this.described === 0
      ? "No fixes described yet."
      : `${this.published} of ${this.described} described fixes are live in Knowledge.`;
  }

  // ── Cadence: seven days of capture ──────────────────────────────────────
  get cadence() {
    const raw = this.s.trend || [];
    const max = raw.reduce((m, t) => Math.max(m, t.count || 0), 0);
    // The controller returns seven entries, oldest first, ending today. Weekday
    // labels are derived from that ordering rather than parsed out of the Apex
    // locale-formatted string, which would not survive outside en-US.
    return raw.map((t, i) => {
      const day = new Date();
      day.setDate(day.getDate() - (raw.length - 1 - i));
      const count = t.count || 0;
      const isToday = i === raw.length - 1;
      return {
        key: `${t.label}-${i}`,
        title: `${t.label} - ${pluralise(count, "fix")} described`,
        short: day.toLocaleDateString(undefined, { weekday: "narrow" }),
        count,
        columnClass: isToday
          ? "codify-spark__fill codify-spark__fill_today"
          : "codify-spark__fill",
        style: `height:${max > 0 ? Math.max(Math.round((count / max) * 100), count > 0 ? 8 : 2) : 2}%`
      };
    });
  }

  get cadenceSummary() {
    const raw = this.s.trend || [];
    const total = raw.reduce((sum, t) => sum + (t.count || 0), 0);
    return total === 0
      ? "No fixes described in the last seven days."
      : `${pluralise(total, "fix")} described in the last seven days.`;
  }

  // ── What the record shows ───────────────────────────────────────────────
  get rootCauseRows() {
    return this.toRows(this.s.topRootCauses);
  }

  get technicianRows() {
    return this.toRows(this.s.topTechnicians);
  }

  get changeTypeRows() {
    return this.toRows(this.s.byChangeType);
  }

  toRows(tallies) {
    return (tallies || []).map((t) => ({ label: t.label, count: t.count }));
  }

  // ── Collapsible sections ────────────────────────────────────────────────
  toggleAnalysis() {
    this.analysisExpanded = !this.analysisExpanded;
  }

  toggleActivity() {
    this.activityExpanded = !this.activityExpanded;
  }

  // ── Actions ─────────────────────────────────────────────────────────────
  async handleRefresh() {
    this.isRefreshing = true;
    try {
      await Promise.all([
        refreshApex(this.summaryResult),
        refreshApex(this.activityResult)
      ]);
      this.lastRefreshed = new Date();
      this.dispatchEvent(
        new ShowToastEvent({
          title: "Figures refreshed",
          message: this.lastRefreshedLabel,
          variant: "success"
        })
      );
    } catch (error) {
      logError("Home dashboard refresh", error);
      this.dispatchEvent(
        new ShowToastEvent({
          title: "Could not refresh",
          message: reduceApexError(
            error,
            "Codify could not refresh the figures."
          ).message,
          variant: "error"
        })
      );
    } finally {
      this.isRefreshing = false;
    }
  }

  handleRetrySummary() {
    this.summaryError = undefined;
    this.handleRefresh();
  }

  handleRetryActivity() {
    this.activityError = undefined;
    refreshApex(this.activityResult);
  }

  handleOpenReviews() {
    this.navigateToTab("Codify_Pending_Article_Reviews");
  }

  handleOpenChangeLog() {
    this.navigateToTab("Codify_Change_Log");
  }

  navigateToTab(apiName) {
    this[NavigationMixin.Navigate]({
      type: "standard__navItemPage",
      attributes: { apiName }
    });
  }

  handleOpenRecord(event) {
    const recordId = event.currentTarget.dataset.id;
    if (recordId) {
      this[NavigationMixin.Navigate]({
        type: "standard__recordPage",
        attributes: { recordId, actionName: "view" }
      });
    }
  }
}
