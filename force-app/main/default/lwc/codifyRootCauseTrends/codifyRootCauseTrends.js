import { LightningElement, wire } from "lwc";
import { refreshApex } from "@salesforce/apex";
import { ShowToastEvent } from "lightning/platformShowToastEvent";
import getRootCauseTrends from "@salesforce/apex/Codify_HomeDashboardController.getRootCauseTrends";
import { reduceApexError, logError, pluralise } from "c/codifyDisplay";

/**
 * Which root causes keep coming back, and whether the knowledge base has caught
 * up with them.
 *
 * Coverage is the reason this tab exists: a cause that recurs with no article
 * behind it is precisely the documentation gap Codify was built to close, so it
 * is stated as a status rather than left to be inferred from two number columns.
 * That is also why gaps are counted into a KPI above the list and can be sorted
 * to the top.
 *
 * Presented as a ranked list with small multiples rather than a chart or a
 * datatable. Each row carries three measures on scales shared across the whole
 * set, so the columns are comparable down the page; axes, gridlines and legends
 * would be chrome around three numbers. The classification thresholds are
 * unchanged from the original implementation.
 */
const WINDOW_OPTIONS = [
  { label: "Last 30 days", value: "30" },
  { label: "Last 90 days", value: "90" },
  { label: "Last 180 days", value: "180" },
  { label: "Last 365 days", value: "365" }
];

const SORT_OPTIONS = [
  { label: "Most recurrent", value: "occurrences" },
  { label: "Biggest coverage gap", value: "gap" },
  { label: "Most recently seen", value: "recent" },
  { label: "Root cause A–Z", value: "name" }
];

/** rank orders worst-coverage-first when sorting by gap. */
const COVERAGE = {
  documented: {
    key: "documented",
    label: "Documented",
    tone: "success",
    icon: "utility:check",
    rank: 3
  },
  notYet: {
    key: "notYet",
    label: "Not yet",
    tone: "neutral",
    icon: "utility:clock",
    rank: 2
  },
  thin: {
    key: "thin",
    label: "Thin",
    tone: "pending",
    icon: "utility:dash",
    rank: 1
  },
  gap: {
    key: "gap",
    label: "Gap",
    tone: "critical",
    icon: "utility:warning",
    rank: 0
  }
};

const INITIAL_VISIBLE = 10;

export default class CodifyRootCauseTrends extends LightningElement {
  windowOptions = WINDOW_OPTIONS;
  sortOptions = SORT_OPTIONS;

  daysBack = "90";
  sortBy = "occurrences";
  searchTerm = "";
  showAll = false;

  rows = [];
  error;
  isRefreshing = false;
  isFetching = true;

  trendsResult;

  @wire(getRootCauseTrends, { daysBack: "$daysBackNumber" })
  wiredTrends(result) {
    this.trendsResult = result;
    const { data, error } = result;
    if (data) {
      this.rows = data.map((t) => this.classify(t));
      this.error = undefined;
      this.isFetching = false;
    } else if (error) {
      logError("Root cause trends", error);
      this.error = reduceApexError(
        error,
        "Codify could not read the root cause trends."
      );
      this.rows = [];
      this.isFetching = false;
    }
  }

  /**
   * Coverage classification, with the original thresholds preserved: no article
   * at all on a cause seen more than once is a gap, and fewer than one article
   * per three occurrences is thin.
   */
  classify(t) {
    let coverage = COVERAGE.documented;
    if (t.articlesDrafted === 0) {
      coverage = t.occurrences > 1 ? COVERAGE.gap : COVERAGE.notYet;
    } else if (t.occurrences > t.articlesDrafted * 3) {
      coverage = COVERAGE.thin;
    }
    return { ...t, coverage };
  }

  get daysBackNumber() {
    return parseInt(this.daysBack, 10);
  }

  // ── Filtering, sorting, paging ──────────────────────────────────────────
  get filteredRows() {
    const term = this.searchTerm.trim().toLowerCase();
    const matched = term
      ? this.rows.filter((r) =>
          (r.rootCause || "").toLowerCase().includes(term)
        )
      : [...this.rows];

    return matched.sort((a, b) => {
      switch (this.sortBy) {
        case "gap":
          return (
            a.coverage.rank - b.coverage.rank || b.occurrences - a.occurrences
          );
        case "recent":
          return new Date(b.lastSeen) - new Date(a.lastSeen);
        case "name":
          return (a.rootCause || "").localeCompare(b.rootCause || "");
        default:
          return b.occurrences - a.occurrences;
      }
    });
  }

  /**
   * Bars are scaled per measure across the whole filtered set rather than per
   * row, which is what makes the small multiples readable as columns.
   */
  get displayRows() {
    const all = this.filteredRows;
    const visible = this.showAll ? all : all.slice(0, INITIAL_VISIBLE);
    const maxOccurrences = all.reduce(
      (m, r) => Math.max(m, r.occurrences || 0),
      0
    );
    const maxArticles = all.reduce(
      (m, r) => Math.max(m, r.articlesDrafted || 0),
      0
    );
    const maxFlagged = all.reduce(
      (m, r) => Math.max(m, r.relatedCasesFlagged || 0),
      0
    );

    return visible.map((r, i) => ({
      ...r,
      rank: i + 1,
      barStyle: `width:${this.share(r.occurrences, maxOccurrences)}%`,
      multiples: [
        {
          key: "articles",
          label: "Articles",
          value: r.articlesDrafted,
          barClass: "codify-micro__bar codify-micro__bar_good",
          style: `width:${this.share(r.articlesDrafted, maxArticles)}%`
        },
        {
          key: "reached",
          label: "Cases reached",
          value: r.relatedCasesFlagged,
          barClass: "codify-micro__bar codify-micro__bar_accent",
          style: `width:${this.share(r.relatedCasesFlagged, maxFlagged)}%`
        }
      ],
      srSummary: `${r.rootCause}: ${pluralise(
        r.occurrences,
        "case"
      )} resolved, ${pluralise(
        r.articlesDrafted,
        "article"
      )} drafted, ${pluralise(
        r.relatedCasesFlagged,
        "other case"
      )} reached. Coverage: ${r.coverage.label}.`
    }));
  }

  share(value, max) {
    const v = Number(value) || 0;
    if (!max || max <= 0) {
      return 0;
    }
    return Math.max(Math.round((v / max) * 100), v > 0 ? 4 : 0);
  }

  get hasRows() {
    return this.displayRows.length > 0;
  }

  get isFiltered() {
    return this.searchTerm.trim().length > 0;
  }

  get hiddenCount() {
    return Math.max(this.filteredRows.length - INITIAL_VISIBLE, 0);
  }

  get canExpand() {
    return !this.showAll && this.hiddenCount > 0;
  }

  get expandLabel() {
    return `Show all ${this.filteredRows.length} root causes`;
  }

  get resultCountLabel() {
    if (this.isFetching) {
      return "";
    }
    return this.isFiltered
      ? `${this.displayRows.length} of ${this.rows.length} shown`
      : pluralise(this.rows.length, "root cause");
  }

  // ── Summary figures ─────────────────────────────────────────────────────
  get gapCount() {
    return this.rows.filter((r) => r.coverage.key === "gap").length;
  }

  get recurringCount() {
    return this.rows.filter((r) => r.occurrences > 1).length;
  }

  get casesReached() {
    return this.rows.reduce((sum, r) => sum + (r.relatedCasesFlagged || 0), 0);
  }

  get gapTone() {
    return this.gapCount === 0 ? "good" : "critical";
  }

  get gapSupportingText() {
    return this.gapCount === 0
      ? "Every recurring root cause has at least one article behind it."
      : "Recurring causes with no Knowledge article yet - the documentation gaps Codify exists to close.";
  }

  get recurringSupportingText() {
    return `Seen more than once out of ${pluralise(
      this.rows.length,
      "cause"
    )} tagged in this window.`;
  }

  get windowLabel() {
    const match = WINDOW_OPTIONS.find((o) => o.value === this.daysBack);
    return match ? match.label.toLowerCase() : "this window";
  }

  get sortLabel() {
    const match = SORT_OPTIONS.find((o) => o.value === this.sortBy);
    return match ? match.label : "volume";
  }

  get listDescription() {
    return `${this.sortLabel} first, ${this.windowLabel}. Bars are scaled across every cause shown, so the columns compare down the page.`;
  }

  get emptyMessage() {
    return this.isFiltered
      ? `Nothing matches "${this.searchTerm.trim()}" in ${this.windowLabel}.`
      : `No root cause was tagged in ${this.windowLabel}. Codify only tags a cause when a recap corroborates it twice, so a quiet window is a real answer rather than a gap in the data.`;
  }

  get emptyActionLabel() {
    return this.isFiltered ? "Clear the search" : undefined;
  }

  get refreshLabel() {
    return this.isRefreshing ? "Refreshing…" : "Refresh";
  }

  // ── Handlers ────────────────────────────────────────────────────────────
  handleWindow(event) {
    this.daysBack = event.detail.value;
    this.showAll = false;
    this.isFetching = true;
  }

  handleSort(event) {
    this.sortBy = event.detail.value;
  }

  handleSearch(event) {
    this.searchTerm = event.target.value || "";
    this.showAll = false;
  }

  handleClearSearch() {
    this.searchTerm = "";
  }

  handleShowAll() {
    this.showAll = true;
  }

  async handleRefresh() {
    this.isRefreshing = true;
    try {
      await refreshApex(this.trendsResult);
      this.dispatchEvent(
        new ShowToastEvent({
          title: "Trends refreshed",
          message: `${pluralise(this.rows.length, "root cause")} in ${
            this.windowLabel
          }.`,
          variant: "success"
        })
      );
    } catch (error) {
      logError("Root cause trends refresh", error);
      this.dispatchEvent(
        new ShowToastEvent({
          title: "Could not refresh",
          message: reduceApexError(
            error,
            "Codify could not refresh the trends."
          ).message,
          variant: "error"
        })
      );
    } finally {
      this.isRefreshing = false;
    }
  }

  handleRetry() {
    this.error = undefined;
    this.isFetching = true;
    refreshApex(this.trendsResult);
  }
}
