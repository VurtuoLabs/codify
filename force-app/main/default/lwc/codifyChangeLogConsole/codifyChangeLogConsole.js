import { LightningElement, wire } from "lwc";
import { NavigationMixin } from "lightning/navigation";
import { ShowToastEvent } from "lightning/platformShowToastEvent";
import getChanges from "@salesforce/apex/Codify_ChangeLogConsoleController.getChanges";
import getFilterOptions from "@salesforce/apex/Codify_ChangeLogConsoleController.getFilterOptions";
import {
  changeMeta,
  reduceApexError,
  logError,
  pluralise
} from "c/codifyDisplay";

/**
 * The audit console: every write Codify has made, with its before and after
 * values and a route back to the recap that caused it.
 *
 * Presented as a purpose-built responsive table rather than lightning-datatable.
 * That is a deliberate exception to "use the base component": the rows here are
 * audit entries, not fields - the decision-critical cell is a before/after diff,
 * two columns are status pills, and eleven columns of it has to stay readable on
 * a phone. A datatable cannot render a diff or a pill without a custom cell type
 * and does not restack on small screens; this table does both, and each row can
 * expand to show values that are too long to sit in a cell.
 *
 * Server-side filtering, paging and limits are unchanged: the same six filters go
 * to the same cacheable Apex method. Search, sorting and paging are applied to
 * the fetched page in the browser, which is why the page size and the fetch
 * limit are labelled separately - nothing here pretends to have searched rows it
 * has not loaded.
 */
const PAGE_SIZE_OPTIONS = [
  { label: "25 per page", value: "25" },
  { label: "50 per page", value: "50" },
  { label: "100 per page", value: "100" }
];

const FETCH_STEP = 200;
const FETCH_CEILING = 2000;

const SORTABLE = {
  name: "text",
  changeType: "text",
  relatedRecordName: "text",
  technicianName: "text",
  createdDate: "date",
  requiresHumanReview: "boolean"
};

export default class CodifyChangeLogConsole extends NavigationMixin(
  LightningElement
) {
  pageSizeOptions = PAGE_SIZE_OPTIONS;

  rows = [];
  error;
  isLoading = true;
  isFetchingMore = false;

  // Server-side filters
  technicianFilter = "";
  caseFilter = "";
  rootCauseFilter = "";
  typeFilter = "";
  startDate = null;
  endDate = null;
  maxRows = FETCH_STEP;

  // Client-side view state
  searchTerm = "";
  sortField = "createdDate";
  sortAscending = false;
  pageSize = "25";
  pageNumber = 1;
  expandedId;
  filtersExpanded = true;

  technicianOptions = [{ label: "All technicians", value: "" }];
  rootCauseOptions = [{ label: "All root causes", value: "" }];
  typeOptions = [{ label: "All change types", value: "" }];
  optionsError;

  connectedCallback() {
    this.loadData();
  }

  @wire(getFilterOptions)
  wiredOptions({ data, error }) {
    if (data) {
      this.technicianOptions = [{ label: "All technicians", value: "" }].concat(
        (data.technicians || []).map((t) => ({
          label: t.label,
          value: t.value
        }))
      );
      this.rootCauseOptions = [{ label: "All root causes", value: "" }].concat(
        (data.rootCauses || []).map((c) => ({ label: c, value: c }))
      );
      this.typeOptions = [{ label: "All change types", value: "" }].concat(
        (data.changeTypes || []).map((t) => ({ label: t, value: t }))
      );
      this.optionsError = undefined;
    } else if (error) {
      logError("Change log filter options", error);
      // A missing options list is not worth blocking the table for: the filters
      // fall back to "All" and the table still loads.
      this.optionsError = reduceApexError(
        error,
        "Codify could not load the filter choices."
      );
    }
  }

  async loadData({ isFetchingMore = false } = {}) {
    if (isFetchingMore) {
      this.isFetchingMore = true;
    } else {
      this.isLoading = true;
    }
    this.error = undefined;
    try {
      const data = await getChanges({
        technicianId: this.technicianFilter || null,
        caseId: this.caseFilter || null,
        rootCause: this.rootCauseFilter || null,
        changeType: this.typeFilter || null,
        startDate: this.startDate || null,
        endDate: this.endDate || null,
        maxRows: this.maxRows
      });
      this.rows = data || [];
    } catch (e) {
      logError("Change log query", e);
      this.error = reduceApexError(e, "Codify could not read the change log.");
      this.rows = [];
    } finally {
      this.isLoading = false;
      this.isFetchingMore = false;
    }
  }

  // ── Derived view ────────────────────────────────────────────────────────
  get matchedRows() {
    const term = this.searchTerm.trim().toLowerCase();
    if (!term) {
      return this.rows;
    }
    return this.rows.filter((r) =>
      [
        r.name,
        r.changeType,
        r.relatedRecordName,
        r.rootCause,
        r.fieldName,
        r.oldValue,
        r.newValue,
        r.technicianName
      ]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term))
    );
  }

  get sortedRows() {
    const type = SORTABLE[this.sortField] || "text";
    const direction = this.sortAscending ? 1 : -1;
    return [...this.matchedRows].sort((a, b) => {
      const av = a[this.sortField];
      const bv = b[this.sortField];
      let comparison;
      if (type === "date") {
        comparison = new Date(av || 0) - new Date(bv || 0);
      } else if (type === "boolean") {
        comparison = (av === true ? 1 : 0) - (bv === true ? 1 : 0);
      } else {
        comparison = String(av || "").localeCompare(String(bv || ""));
      }
      return comparison * direction;
    });
  }

  get pageSizeNumber() {
    return parseInt(this.pageSize, 10);
  }

  get pageCount() {
    return Math.max(Math.ceil(this.sortedRows.length / this.pageSizeNumber), 1);
  }

  get safePageNumber() {
    return Math.min(Math.max(this.pageNumber, 1), this.pageCount);
  }

  /** Only the current page is rendered, so a 2000-row fetch stays responsive. */
  get pageRows() {
    const start = (this.safePageNumber - 1) * this.pageSizeNumber;
    return this.sortedRows
      .slice(start, start + this.pageSizeNumber)
      .map((r) => this.decorate(r));
  }

  decorate(row) {
    const meta = changeMeta(row.changeType);
    const expanded = this.expandedId === row.id;
    return {
      ...row,
      typeIcon: meta.icon,
      typeTone: meta.tone,
      hasDiff: Boolean(row.oldValue || row.newValue),
      hasOldValue: Boolean(row.oldValue),
      needsReview: row.requiresHumanReview === true,
      expanded,
      expandedString: String(expanded),
      detailKey: `${row.id}-detail`,
      rowClass: expanded ? "codify-tr codify-tr_expanded" : "codify-tr",
      chevronIcon: expanded ? "utility:chevrondown" : "utility:chevronright",
      chevronLabel: expanded
        ? `Hide details for change ${row.name}`
        : `Show details for change ${row.name}`,
      actionsLabel: `Actions for change ${row.name}`,
      canOpenRecord: Boolean(row.relatedRecordId),
      canOpenRecap: Boolean(row.sourceResolutionLogId),
      recordActionDisabled: !row.relatedRecordId,
      recapActionDisabled: !row.sourceResolutionLogId,
      recapLabel: row.sourceResolutionLogName
        ? `Open ${row.sourceResolutionLogName}`
        : "Open source recap",
      // The cells clamp long values; the expanded row shows them in full, and
      // says so explicitly when a value was empty rather than rendering nothing.
      fieldNameDisplay: row.fieldName || "No field changed",
      oldValueDisplay: row.oldValue || "(blank)",
      newValueDisplay: row.newValue || "(blank)"
    };
  }

  get hasRows() {
    return this.pageRows.length > 0;
  }

  get isEmptyAfterLoad() {
    return !this.isLoading && !this.error && this.sortedRows.length === 0;
  }

  // ── Sorting headers ─────────────────────────────────────────────────────
  /**
   * Per-column sort presentation, so each `th` can render its own arrow and
   * aria-sort without nine near-identical getters.
   */
  get sortMeta() {
    const meta = {};
    Object.keys(SORTABLE).forEach((field) => {
      const active = this.sortField === field;
      meta[field] = {
        active,
        ariaSort: active
          ? this.sortAscending
            ? "ascending"
            : "descending"
          : "none",
        icon: active
          ? this.sortAscending
            ? "utility:arrowup"
            : "utility:arrowdown"
          : "utility:arrowdown",
        buttonClass: active ? "codify-th codify-th_active" : "codify-th",
        assistiveText: active
          ? this.sortAscending
            ? "Sorted ascending. Activate to sort descending."
            : "Sorted descending. Activate to sort ascending."
          : "Not sorted. Activate to sort by this column."
      };
    });
    return meta;
  }

  handleSort(event) {
    const field = event.currentTarget.dataset.field;
    if (!field || !SORTABLE[field]) {
      return;
    }
    if (this.sortField === field) {
      this.sortAscending = !this.sortAscending;
    } else {
      this.sortField = field;
      // Dates read newest-first by default; text reads A–Z.
      this.sortAscending = SORTABLE[field] !== "date";
    }
    this.pageNumber = 1;
  }

  // ── Counts and labels ───────────────────────────────────────────────────
  get rowCountLabel() {
    if (this.isLoading) {
      return "Loading changes…";
    }
    const total = this.rows.length;
    const matched = this.sortedRows.length;
    if (this.searchTerm.trim() && matched !== total) {
      return `${matched} of ${pluralise(total, "change")} match`;
    }
    return pluralise(total, "change");
  }

  get rangeLabel() {
    const matched = this.sortedRows.length;
    if (matched === 0) {
      return "";
    }
    const start = (this.safePageNumber - 1) * this.pageSizeNumber + 1;
    const end = Math.min(start + this.pageSizeNumber - 1, matched);
    return `Showing ${start}–${end} of ${matched}`;
  }

  get pageLabel() {
    return `Page ${this.safePageNumber} of ${this.pageCount}`;
  }

  get isFirstPage() {
    return this.safePageNumber <= 1;
  }

  get isLastPage() {
    return this.safePageNumber >= this.pageCount;
  }

  get activeFilterCount() {
    return [
      this.technicianFilter,
      this.caseFilter,
      this.rootCauseFilter,
      this.typeFilter,
      this.startDate,
      this.endDate
    ].filter(Boolean).length;
  }

  get hasActiveFilters() {
    return this.activeFilterCount > 0 || this.searchTerm.trim().length > 0;
  }

  get filterCountLabel() {
    const n = this.activeFilterCount;
    return n === 0 ? "" : `${n} active`;
  }

  /** True when the server returned exactly what we asked for: there may be more. */
  get canFetchMore() {
    return (
      !this.isLoading &&
      this.rows.length >= this.maxRows &&
      this.maxRows < FETCH_CEILING
    );
  }

  get fetchMoreLabel() {
    return this.isFetchingMore ? "Loading records…" : "Fetch 200 more";
  }

  get fetchNote() {
    return `Newest ${this.rows.length} changes fetched. Search and sorting apply to these.`;
  }

  get emptyTitle() {
    return this.hasActiveFilters
      ? "No changes match these filters"
      : "Codify has not changed anything yet";
  }

  get emptyMessage() {
    return this.hasActiveFilters
      ? "Every write Codify makes is recorded, so an empty result means nothing matched - not that something went unrecorded."
      : "Once a technician describes a fix, each write Codify makes appears here with its before and after values and a link back to the recap.";
  }

  get emptyActionLabel() {
    return this.hasActiveFilters ? "Clear all filters" : undefined;
  }

  get filtersToggleLabel() {
    return this.filtersExpanded ? "Hide filters" : "Show filters";
  }

  get filtersExpandedString() {
    return String(this.filtersExpanded);
  }

  // ── Filter handlers (unchanged server contract) ─────────────────────────
  handleTechnician(event) {
    this.technicianFilter = event.detail.value;
    this.resetPaging();
    this.loadData();
  }

  handleRootCause(event) {
    this.rootCauseFilter = event.detail.value;
    this.resetPaging();
    this.loadData();
  }

  handleType(event) {
    this.typeFilter = event.detail.value;
    this.resetPaging();
    this.loadData();
  }

  // Free text rather than a picklist: service ops usually arrives here from a
  // specific Case id, not from browsing every Case Codify has touched.
  handleCase(event) {
    this.caseFilter = event.target.value;
  }

  handleCaseCommit() {
    this.resetPaging();
    this.loadData();
  }

  handleStart(event) {
    this.startDate = event.target.value;
    this.resetPaging();
    this.loadData();
  }

  handleEnd(event) {
    this.endDate = event.target.value;
    this.resetPaging();
    this.loadData();
  }

  handleSearch(event) {
    this.searchTerm = event.target.value || "";
    this.pageNumber = 1;
  }

  handleReset() {
    this.technicianFilter = "";
    this.caseFilter = "";
    this.rootCauseFilter = "";
    this.typeFilter = "";
    this.startDate = null;
    this.endDate = null;
    this.searchTerm = "";
    this.maxRows = FETCH_STEP;
    this.resetPaging();
    this.loadData();
    this.dispatchEvent(
      new ShowToastEvent({
        title: "Filters cleared",
        message: "Showing the most recent changes across every technician.",
        variant: "success"
      })
    );
  }

  resetPaging() {
    this.pageNumber = 1;
    this.expandedId = undefined;
  }

  toggleFilters() {
    this.filtersExpanded = !this.filtersExpanded;
  }

  // ── Paging ──────────────────────────────────────────────────────────────
  handlePageSize(event) {
    this.pageSize = event.detail.value;
    this.pageNumber = 1;
  }

  handlePrevious() {
    this.pageNumber = Math.max(this.safePageNumber - 1, 1);
  }

  handleNext() {
    this.pageNumber = Math.min(this.safePageNumber + 1, this.pageCount);
  }

  handleFetchMore() {
    this.maxRows = Math.min(this.maxRows + FETCH_STEP, FETCH_CEILING);
    this.loadData({ isFetchingMore: true });
  }

  handleRefresh() {
    this.loadData();
  }

  handleRetry() {
    this.loadData();
  }

  // ── Row interactions ────────────────────────────────────────────────────
  toggleRow(event) {
    const id = event.currentTarget.dataset.id;
    this.expandedId = this.expandedId === id ? undefined : id;
  }

  handleRowAction(event) {
    const action = event.detail.value;
    const id = event.currentTarget.dataset.id;
    const row = this.rows.find((r) => r.id === id);
    if (!row) {
      return;
    }
    if (action === "open_recap" && row.sourceResolutionLogId) {
      this.navigateTo(row.sourceResolutionLogId);
    } else if (action === "open_record" && row.relatedRecordId) {
      this.navigateTo(row.relatedRecordId);
    }
  }

  handleOpenRecord(event) {
    const recordId = event.currentTarget.dataset.id;
    if (recordId) {
      this.navigateTo(recordId);
    }
  }

  navigateTo(recordId) {
    this[NavigationMixin.Navigate]({
      type: "standard__recordPage",
      attributes: { recordId, actionName: "view" }
    });
  }
}
