import { LightningElement, api } from "lwc";

/**
 * One status pill for the whole app.
 *
 * State is never carried by colour alone: every tone ships a default icon and
 * the label is always rendered, so the badge still reads for a colour-blind
 * reviewer, in high contrast mode, and in a screen reader.
 */
const TONE_ICONS = {
  neutral: "utility:dash",
  accent: "utility:record",
  success: "utility:success",
  pending: "utility:clock",
  critical: "utility:warning",
  info: "utility:info"
};

const TONES = Object.keys(TONE_ICONS);

export default class CodifyStatusBadge extends LightningElement {
  /** Visible text. Required - a pill with no label is a colour-only signal. */
  @api label;

  /** neutral | accent | success | pending | critical | info */
  @api tone = "neutral";

  /** Overrides the tone's default icon when a more specific one reads better. */
  @api iconName;

  /** Hover text; falls back to the label. */
  @api tooltip;

  /** Screen-reader-only prefix, e.g. "Coverage:" so the pill has context. */
  @api assistivePrefix = "";

  /** Slightly tighter pill for use inside table cells and list rows. */
  @api compact = false;

  get safeTone() {
    return TONES.includes(this.tone) ? this.tone : "neutral";
  }

  get resolvedIcon() {
    return this.iconName || TONE_ICONS[this.safeTone];
  }

  get tooltipText() {
    return this.tooltip || this.label;
  }

  get badgeClass() {
    return [
      "codify-badge",
      `codify-badge_${this.safeTone}`,
      this.compact ? "codify-badge_compact" : ""
    ]
      .filter(Boolean)
      .join(" ");
  }
}
