import { LightningElement, wire } from "lwc";
import { NavigationMixin } from "lightning/navigation";
import { refreshApex } from "@salesforce/apex";
import { ShowToastEvent } from "lightning/platformShowToastEvent";
import getPendingArticles from "@salesforce/apex/Codify_ArticleReviewController.getPendingArticles";
import saveDraft from "@salesforce/apex/Codify_ArticleReviewController.saveDraft";
import rejectDraft from "@salesforce/apex/Codify_ArticleReviewController.rejectDraft";
import { reduceApexError, logError, pluralise } from "c/codifyDisplay";

/**
 * The review desk proper.
 *
 * A Knowledge owner reads the draft next to the technician's verbatim recap, so
 * they can check what Codify wrote against what was actually said rather than
 * judging the prose on its own. The layout says that out loud: the draft is set
 * as a manuscript - serif, a comfortable measure, generous leading - and the
 * reviewer's controls are visually separate from it. Reading is the default
 * state; editing is something you deliberately enter, which is also what keeps
 * the "compare it to the recap" step from being skipped.
 *
 * There is deliberately no publish button. Publishing happens through
 * Salesforce's native Knowledge process, operated by a person; putting it here
 * would turn a hard guardrail into a one-click bypass. The lifecycle indicator
 * says so explicitly - the fourth step is shown, and it is not ours to complete.
 *
 * Rejecting deletes a draft, so it is separated from Save, styled as
 * destructive, and confirmed in a dialog that states what will happen.
 */
const MAX_TITLE = 255;
const MAX_SUMMARY = 1000;

export default class CodifyArticleReviewPanel extends NavigationMixin(
  LightningElement
) {
  articles = [];
  selected;
  error;
  loaded = false;

  isSaving = false;
  isRejecting = false;
  showRejectDialog = false;
  rejectReason = "";

  mode = "read";
  savedNotice;
  titleError;

  draftTitle = "";
  draftSummary = "";
  draftBody = "";

  wiredResult;
  focusDialogOnRender = false;

  @wire(getPendingArticles, { maxRows: 100 })
  wiredArticles(result) {
    this.wiredResult = result;
    const { data, error } = result;
    if (data) {
      this.articles = data;
      this.error = undefined;
      this.loaded = true;

      // Keep the current selection across refreshes, and do not overwrite edits
      // in progress just because the queue was re-read.
      const stillThere =
        this.selected && data.find((a) => a.id === this.selected.id);
      const next = stillThere || data[0];
      const sameSelection = Boolean(
        this.selected && next && next.id === this.selected.id
      );
      this.selected = next;
      if (next && (!sameSelection || !this.isDirty)) {
        this.resetWorkingCopy(next);
      }
      if (!next) {
        this.resetWorkingCopy();
      }
    } else if (error) {
      logError("Pending article queue", error);
      this.error = reduceApexError(
        error,
        "Codify could not read the drafts waiting for review."
      );
      this.articles = [];
      this.loaded = true;
    }
  }

  resetWorkingCopy(article) {
    this.draftTitle = article?.title || "";
    this.draftSummary = article?.summary || "";
    this.draftBody = article?.body || "";
    this.titleError = undefined;
    this.mode = "read";
  }

  // ── Load and shape ──────────────────────────────────────────────────────
  get isLoading() {
    return !this.loaded && !this.error;
  }

  get hasArticles() {
    return this.articles.length > 0;
  }

  get queue() {
    return this.articles.map((a, i) => {
      const isSelected = Boolean(this.selected && a.id === this.selected.id);
      return {
        ...a,
        position: i + 1,
        isSelected,
        ariaCurrent: isSelected ? "true" : "false",
        itemClass: isSelected
          ? "codify-queue__item codify-queue__item_selected"
          : "codify-queue__item",
        caseLabel: a.sourceCaseNumber ? `Case ${a.sourceCaseNumber}` : null,
        technicianLabel: a.technicianName || "Unattributed"
      };
    });
  }

  get queueCountLabel() {
    return pluralise(this.articles.length, "draft");
  }

  get queueHeaderDescription() {
    return this.articles.length === 1
      ? "One draft is waiting on a person."
      : `${this.articles.length} drafts are waiting on a person. Codify wrote them; none of them is live.`;
  }

  get selectedPosition() {
    const index = this.articles.findIndex(
      (a) => this.selected && a.id === this.selected.id
    );
    return index < 0 ? "" : `Draft ${index + 1} of ${this.articles.length}`;
  }

  // ── Read / edit ─────────────────────────────────────────────────────────
  get isReadMode() {
    return this.mode === "read";
  }

  get isEditMode() {
    return this.mode === "edit";
  }

  get isDirty() {
    if (!this.selected) {
      return false;
    }
    return (
      this.draftTitle !== (this.selected.title || "") ||
      this.draftSummary !== (this.selected.summary || "") ||
      this.draftBody !== (this.selected.body || "")
    );
  }

  get dirtyLabel() {
    return this.isDirty ? "Unsaved changes" : "No changes yet";
  }

  get dirtyTone() {
    return this.isDirty ? "pending" : "neutral";
  }

  get saveLabel() {
    return this.isSaving ? "Saving…" : "Save draft";
  }

  get rejectLabel() {
    return this.isRejecting ? "Rejecting…" : "Reject draft…";
  }

  get saveDisabled() {
    return this.isSaving || this.isRejecting || !this.isDirty;
  }

  get actionsDisabled() {
    return this.isSaving || this.isRejecting;
  }

  get bodyForDisplay() {
    return this.draftBody || "<p><em>This draft has no body yet.</em></p>";
  }

  get hasSummary() {
    return Boolean(this.draftSummary);
  }

  get hasRecap() {
    return Boolean(this.selected?.originalRecap);
  }

  get titleLengthLabel() {
    return `${this.draftTitle.length} of ${MAX_TITLE} characters`;
  }

  get maxTitle() {
    return MAX_TITLE;
  }

  get maxSummary() {
    return MAX_SUMMARY;
  }

  /**
   * The draft's lifecycle, not the reviewer's clicks. The fourth step is shown
   * and never completed here on purpose: publishing is a Knowledge action, and
   * seeing that gap is the point.
   */
  get lifecycleStep() {
    return "review";
  }

  handleSelect(event) {
    const id = event.currentTarget.dataset.id;
    if (this.selected && id === this.selected.id) {
      return;
    }
    if (this.isDirty && this.isEditMode) {
      // Refuse silently losing a reviewer's edits.
      this.toast(
        "Finish this draft first",
        "Save or discard your changes before opening another draft.",
        "warning"
      );
      return;
    }
    const next = this.articles.find((a) => a.id === id);
    this.selected = next;
    this.savedNotice = undefined;
    this.resetWorkingCopy(next);
  }

  handleEdit() {
    this.mode = "edit";
    this.savedNotice = undefined;
  }

  handleCancelEdit() {
    this.resetWorkingCopy(this.selected);
  }

  handleTitle(event) {
    this.draftTitle = event.target.value;
    this.titleError = this.validateTitle(this.draftTitle);
  }

  handleSummary(event) {
    this.draftSummary = event.target.value;
  }

  handleBody(event) {
    this.draftBody = event.target.value;
  }

  validateTitle(value) {
    const trimmed = (value || "").trim();
    if (!trimmed) {
      return "An article needs a title before it can be saved.";
    }
    if (trimmed.length > MAX_TITLE) {
      return `Titles are limited to ${MAX_TITLE} characters.`;
    }
    return undefined;
  }

  // ── Save ────────────────────────────────────────────────────────────────
  async handleSave() {
    if (!this.selected) {
      return;
    }
    this.titleError = this.validateTitle(this.draftTitle);
    if (this.titleError) {
      const input = this.template.querySelector('[data-id="draft-title"]');
      if (input) {
        input.focus();
      }
      return;
    }

    this.isSaving = true;
    try {
      const message = await saveDraft({
        articleId: this.selected.id,
        title: this.draftTitle,
        summary: this.draftSummary,
        body: this.draftBody
      });
      this.savedNotice = message;
      this.toast("Draft saved", message, "success");
      await refreshApex(this.wiredResult);
      this.mode = "read";
    } catch (e) {
      logError("Save draft", e);
      const reduced = reduceApexError(e, "Codify could not save this draft.");
      this.savedNotice = undefined;
      this.error = undefined;
      this.toast("Could not save", reduced.message, "error");
    } finally {
      this.isSaving = false;
    }
  }

  // ── Reject, behind a confirmation ───────────────────────────────────────
  handleRejectRequest() {
    this.rejectReason = "";
    this.showRejectDialog = true;
    this.focusDialogOnRender = true;
  }

  handleRejectReason(event) {
    this.rejectReason = event.target.value;
  }

  handleCancelReject() {
    this.showRejectDialog = false;
  }

  handleDialogKeydown(event) {
    if (event.key === "Escape") {
      this.showRejectDialog = false;
    }
  }

  async handleConfirmReject() {
    if (!this.selected) {
      return;
    }
    this.isRejecting = true;
    try {
      const message = await rejectDraft({
        articleId: this.selected.id,
        reason: this.rejectReason
      });
      this.showRejectDialog = false;
      this.selected = undefined;
      this.resetWorkingCopy();
      this.toast("Draft rejected", message, "success");
      await refreshApex(this.wiredResult);
    } catch (e) {
      logError("Reject draft", e);
      this.toast(
        "Could not reject",
        reduceApexError(e, "Codify could not reject this draft.").message,
        "error"
      );
    } finally {
      this.isRejecting = false;
    }
  }

  get confirmRejectLabel() {
    return this.isRejecting ? "Rejecting…" : "Reject and delete the draft";
  }

  get rejectDialogTitle() {
    return this.selected
      ? `Reject “${this.selected.title}”?`
      : "Reject this draft?";
  }

  renderedCallback() {
    if (this.focusDialogOnRender) {
      const focusTarget = this.template.querySelector(
        '[data-id="reject-reason"]'
      );
      if (focusTarget) {
        focusTarget.focus();
        this.focusDialogOnRender = false;
      }
    }
  }

  // ── Navigation and retry ────────────────────────────────────────────────
  openRecord(event) {
    const recordId = event.currentTarget.dataset.id;
    if (recordId) {
      this[NavigationMixin.Navigate]({
        type: "standard__recordPage",
        attributes: { recordId, actionName: "view" }
      });
    }
  }

  handleRetry() {
    this.error = undefined;
    this.loaded = false;
    refreshApex(this.wiredResult);
  }

  toast(title, message, variant) {
    this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
  }
}
