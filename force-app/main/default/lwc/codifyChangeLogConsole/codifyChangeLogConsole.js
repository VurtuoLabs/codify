import { LightningElement, wire, track } from "lwc";
import { NavigationMixin } from "lightning/navigation";
import getChanges from "@salesforce/apex/Codify_ChangeLogConsoleController.getChanges";
import getFilterOptions from "@salesforce/apex/Codify_ChangeLogConsoleController.getFilterOptions";

const COLUMNS = [
  { label: "Change #", fieldName: "name", type: "text", fixedWidth: 110 },
  { label: "Type", fieldName: "changeType", type: "text", fixedWidth: 150 },
  {
    label: "Object",
    fieldName: "objectApiName",
    type: "text",
    fixedWidth: 130
  },
  {
    label: "Record",
    fieldName: "relatedRecordName",
    type: "text",
    wrapText: true
  },
  { label: "Root cause", fieldName: "rootCause", type: "text", wrapText: true },
  { label: "Field", fieldName: "fieldName", type: "text" },
  { label: "Before", fieldName: "oldValue", type: "text", wrapText: true },
  { label: "After", fieldName: "newValue", type: "text", wrapText: true },
  { label: "Technician", fieldName: "technicianName", type: "text" },
  {
    label: "Needs review",
    fieldName: "requiresHumanReview",
    type: "boolean",
    fixedWidth: 110
  },
  {
    label: "When",
    fieldName: "createdDate",
    type: "date",
    typeAttributes: {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }
  },
  {
    type: "action",
    typeAttributes: {
      rowActions: [
        { label: "Open source recap", name: "open_recap" },
        { label: "Open changed record", name: "open_record" }
      ]
    }
  }
];

export default class CodifyChangeLogConsole extends NavigationMixin(
  LightningElement
) {
  columns = COLUMNS;
  @track rows = [];
  @track error;
  isLoading = false;

  technicianFilter = "";
  caseFilter = "";
  rootCauseFilter = "";
  typeFilter = "";
  startDate = null;
  endDate = null;
  maxRows = 200;

  technicianOptions = [{ label: "All technicians", value: "" }];
  rootCauseOptions = [{ label: "All root causes", value: "" }];
  typeOptions = [{ label: "All change types", value: "" }];

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
    } else if (error) {
      this.error = this.reduceError(error);
    }
  }

  async loadData() {
    this.isLoading = true;
    this.error = undefined;
    try {
      this.rows = await getChanges({
        technicianId: this.technicianFilter || null,
        caseId: this.caseFilter || null,
        rootCause: this.rootCauseFilter || null,
        changeType: this.typeFilter || null,
        startDate: this.startDate || null,
        endDate: this.endDate || null,
        maxRows: this.maxRows
      });
    } catch (e) {
      this.error = this.reduceError(e);
      this.rows = [];
    } finally {
      this.isLoading = false;
    }
  }

  handleTechnician(e) {
    this.technicianFilter = e.detail.value;
    this.loadData();
  }

  handleRootCause(e) {
    this.rootCauseFilter = e.detail.value;
    this.loadData();
  }

  handleType(e) {
    this.typeFilter = e.detail.value;
    this.loadData();
  }

  // Free-text rather than a picklist: service ops usually arrives here from a
  // specific Case id, not from browsing a list of every Case Codify has touched.
  handleCase(e) {
    this.caseFilter = e.target.value;
  }

  handleCaseCommit() {
    this.loadData();
  }

  handleStart(e) {
    this.startDate = e.target.value;
    this.loadData();
  }

  handleEnd(e) {
    this.endDate = e.target.value;
    this.loadData();
  }

  handleReset() {
    this.technicianFilter = "";
    this.caseFilter = "";
    this.rootCauseFilter = "";
    this.typeFilter = "";
    this.startDate = null;
    this.endDate = null;
    this.loadData();
  }

  handleRowAction(event) {
    const action = event.detail.action.name;
    const row = event.detail.row;
    if (action === "open_recap" && row.sourceResolutionLogId) {
      this.navigateTo(row.sourceResolutionLogId);
    } else if (action === "open_record" && row.relatedRecordId) {
      this.navigateTo(row.relatedRecordId);
    }
  }

  navigateTo(recordId) {
    this[NavigationMixin.Navigate]({
      type: "standard__recordPage",
      attributes: { recordId, actionName: "view" }
    });
  }

  get hasRows() {
    return this.rows && this.rows.length > 0;
  }

  get rowCountLabel() {
    return `${this.rows.length} change${this.rows.length === 1 ? "" : "s"}`;
  }

  reduceError(error) {
    if (Array.isArray(error?.body)) {
      return error.body.map((e) => e.message).join(", ");
    }
    return error?.body?.message || error?.message || "Unknown error";
  }
}
