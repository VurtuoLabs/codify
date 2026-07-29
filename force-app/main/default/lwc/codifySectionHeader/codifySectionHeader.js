import { LightningElement, api } from "lwc";

/**
 * One header treatment for every section and card in the app: optional eyebrow,
 * a real `h2`, a one-line description of what the section is for, a slot for its
 * actions, and an optional collapse control.
 *
 * The heading is always an `h2` so the document outline stays predictable - the
 * page-level `h1` belongs to the tab's own masthead, never to a section.
 */
export default class CodifySectionHeader extends LightningElement {
  @api eyebrow;
  @api title;
  @api description;
  @api iconName;

  /** Small trailing figure, e.g. a row count. Kept out of the heading text. */
  @api count;

  @api collapsible = false;

  // Public booleans must default to false in LWC, so a collapsible section is
  // expected to pass its own state in; the two always travel together.
  @api expanded = false;

  // No aria-controls here on purpose: the region being collapsed lives in the
  // consumer's shadow root, and an idref cannot cross a shadow boundary - it
  // would point at nothing. aria-expanded plus the section name is the honest,
  // working contract.

  get expandedString() {
    return String(this.expanded);
  }

  get toggleAssistiveText() {
    const verb = this.expanded ? "Collapse" : "Expand";
    return `${verb} ${this.title || "section"}`;
  }

  get chevronClass() {
    return this.expanded
      ? "codify-sh__chevron codify-sh__chevron_open"
      : "codify-sh__chevron";
  }

  handleToggle() {
    this.dispatchEvent(new CustomEvent("toggle"));
  }
}
