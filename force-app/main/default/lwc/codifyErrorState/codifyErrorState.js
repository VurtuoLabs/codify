import { LightningElement, api } from "lwc";

/**
 * The app's error surface.
 *
 * Two audiences, one component. The reader gets a plain sentence about what
 * failed and a retry button when retrying is a reasonable thing to do; the
 * developer gets the raw Apex or JS message, behind a disclosure so it is
 * available without being shouted. Callers are expected to have already logged
 * the raw error to the console.
 */
export default class CodifyErrorState extends LightningElement {
  @api title = "That did not load";

  /** Plain-language explanation. Falls back to a generic but honest sentence. */
  @api message;

  /** Raw error text, kept for diagnostics rather than shown by default. */
  @api detail;

  /** Hide when a retry cannot help (e.g. a permissions problem). */
  @api showRetry = false;
  @api retryLabel = "Try again";

  /** Set by the caller while its retry handler is in flight. */
  @api retrying = false;

  /** inline sits in a card body; page fills an otherwise empty tab. */
  @api size = "inline";

  detailExpanded = false;

  get containerClass() {
    return `codify-error codify-error_${this.size === "page" ? "page" : "inline"}`;
  }

  get friendlyMessage() {
    return (
      this.message ||
      "Codify could not read this data. Nothing has been changed. Try again, and if it keeps failing ask an administrator to check the Codify permission sets."
    );
  }

  get retryButtonLabel() {
    return this.retrying ? "Retrying…" : this.retryLabel;
  }

  get detailToggleLabel() {
    return this.detailExpanded ? "Hide technical details" : "Technical details";
  }

  get detailExpandedString() {
    return String(this.detailExpanded);
  }

  toggleDetail() {
    this.detailExpanded = !this.detailExpanded;
  }

  handleRetry() {
    this.dispatchEvent(new CustomEvent("retry"));
  }
}
