import { LightningElement, api } from "lwc";

/**
 * The app's empty state. Never a blank card: a relevant icon, one sentence
 * saying what the absence means, and - where the reader can actually do
 * something about it - a button that does it.
 *
 * "Nothing here" is often the correct, healthy answer in Codify (no drafts
 * waiting, no recap left unclassified), so the copy is supplied by the caller
 * rather than being a generic "No records found".
 */
export default class CodifyEmptyState extends LightningElement {
  @api iconName = "utility:info_alt";
  @api title = "Nothing here yet";
  @api message;

  /** Primary recommended next action. Omit when the reader cannot resolve it. */
  @api actionLabel;
  @api actionIcon;
  @api secondaryActionLabel;

  /** compact fits inside a card body; page adds breathing room for a whole tab. */
  @api size = "compact";

  get containerClass() {
    return `codify-empty codify-empty_${this.size === "page" ? "page" : "compact"}`;
  }

  get hasActions() {
    return Boolean(this.actionLabel || this.secondaryActionLabel);
  }

  handleAction() {
    this.dispatchEvent(new CustomEvent("action"));
  }

  handleSecondaryAction() {
    this.dispatchEvent(new CustomEvent("secondaryaction"));
  }
}
