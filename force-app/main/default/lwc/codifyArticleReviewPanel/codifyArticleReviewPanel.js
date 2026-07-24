import { LightningElement, wire, track } from "lwc";
import { NavigationMixin } from "lightning/navigation";
import { refreshApex } from "@salesforce/apex";
import { ShowToastEvent } from "lightning/platformShowToastEvent";
import getPendingArticles from "@salesforce/apex/Codify_ArticleReviewController.getPendingArticles";
import saveDraft from "@salesforce/apex/Codify_ArticleReviewController.saveDraft";
import rejectDraft from "@salesforce/apex/Codify_ArticleReviewController.rejectDraft";

/**
 * The review surface. A Knowledge owner reads the draft next to the technician's
 * verbatim recap, so they can check what Codify wrote against what was actually
 * said rather than judging the prose on its own.
 *
 * There is deliberately no publish button here. Publishing happens through
 * Salesforce's native Knowledge process, operated by a person; putting it on
 * this panel would turn a hard guardrail into a one-click bypass.
 */
export default class CodifyArticleReviewPanel extends NavigationMixin(
  LightningElement
) {
  @track articles = [];
  @track selected;
  error;
  isSaving = false;
  wiredResult;

  // Working copy of the selected draft, so edits don't mutate the wired data.
  draftTitle = "";
  draftSummary = "";
  draftBody = "";

  @wire(getPendingArticles, { maxRows: 100 })
  wiredArticles(result) {
    this.wiredResult = result;
    const { data, error } = result;
    if (data) {
      this.articles = data;
      this.error = undefined;
      // Keep the current selection across refreshes where possible.
      const stillThere =
        this.selected && data.find((a) => a.id === this.selected.id);
      this.select(stillThere || data[0]);
    } else if (error) {
      this.error = this.reduceError(error);
      this.articles = [];
    }
  }

  select(article) {
    this.selected = article;
    this.draftTitle = article?.title || "";
    this.draftSummary = article?.summary || "";
    this.draftBody = article?.body || "";
  }

  handleSelect(event) {
    const id = event.currentTarget.dataset.id;
    this.select(this.articles.find((a) => a.id === id));
  }

  handleTitle(e) {
    this.draftTitle = e.target.value;
  }

  handleSummary(e) {
    this.draftSummary = e.target.value;
  }

  handleBody(e) {
    this.draftBody = e.target.value;
  }

  async handleSave() {
    if (!this.selected) {
      return;
    }
    this.isSaving = true;
    try {
      const msg = await saveDraft({
        articleId: this.selected.id,
        title: this.draftTitle,
        summary: this.draftSummary,
        body: this.draftBody
      });
      this.toast("Saved", msg, "success");
      await refreshApex(this.wiredResult);
    } catch (e) {
      this.toast("Could not save", this.reduceError(e), "error");
    } finally {
      this.isSaving = false;
    }
  }

  async handleReject() {
    if (!this.selected) {
      return;
    }
    const reason = this.template.querySelector(
      '[data-id="reject-reason"]'
    )?.value;
    this.isSaving = true;
    try {
      const msg = await rejectDraft({ articleId: this.selected.id, reason });
      this.toast("Draft rejected", msg, "success");
      this.selected = undefined;
      await refreshApex(this.wiredResult);
    } catch (e) {
      this.toast("Could not reject", this.reduceError(e), "error");
    } finally {
      this.isSaving = false;
    }
  }

  openRecord(event) {
    const recordId = event.currentTarget.dataset.id;
    if (recordId) {
      this[NavigationMixin.Navigate]({
        type: "standard__recordPage",
        attributes: { recordId, actionName: "view" }
      });
    }
  }

  get queue() {
    return this.articles.map((a) => ({
      ...a,
      itemClass:
        this.selected && a.id === this.selected.id
          ? "codify-queue-item codify-queue-item_selected"
          : "codify-queue-item"
    }));
  }

  get hasArticles() {
    return this.articles.length > 0;
  }

  get queueCountLabel() {
    return `${this.articles.length} awaiting review`;
  }

  reduceError(error) {
    if (Array.isArray(error?.body)) {
      return error.body.map((e) => e.message).join(", ");
    }
    return error?.body?.message || error?.message || "Unknown error";
  }

  toast(title, message, variant) {
    this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
  }
}
