import { LightningElement, api } from "lwc";

/**
 * The app's KPI card: one label, one prominent figure, and only the supporting
 * detail that changes a decision - a proportion bar against a stated
 * denominator, a trend, a sentence of context.
 *
 * It owns its own loading, error and empty presentation so a consumer never has
 * to branch around a missing number, and all three renderings occupy the same
 * box so a dashboard does not reflow as tiles resolve.
 *
 * Tones are semantic, never decorative: `attention` marks work waiting on a
 * person, `good` marks a healthy outcome, `critical` marks something wrong.
 */
const TONES = ["accent", "good", "attention", "critical", "neutral"];

export default class CodifyKpiCard extends LightningElement {
  @api label;

  /** The figure. `null`/`undefined` renders the empty treatment. */
  @api value;

  /** Suffix rendered smaller next to the value, e.g. "%" or "days". */
  @api unit;

  /** One sentence of context under the figure. */
  @api supportingText;

  /** Shown in place of the figure when the value cannot be read. */
  @api emptyMessage;

  @api iconName;

  /** accent | good | attention | critical | neutral */
  @api tone = "accent";

  /** hero for the single most decision-critical figure on a page, else default. */
  @api size = "default";

  /** 0–100. Omit entirely to hide the bar. */
  @api progress;

  /** Describes what the bar is a proportion of, for screen readers. */
  @api progressLabel;

  /** up | down | flat - paired with trendLabel, never shown on its own. */
  @api trendDirection;
  @api trendLabel;

  @api loading = false;

  /** Plain-language failure for this tile only; the page stays usable. */
  @api errorMessage;

  get safeTone() {
    return TONES.includes(this.tone) ? this.tone : "accent";
  }

  get cardClass() {
    return [
      "codify-kpi",
      `codify-kpi_${this.safeTone}`,
      this.size === "hero" ? "codify-kpi_hero" : ""
    ]
      .filter(Boolean)
      .join(" ");
  }

  get isEmpty() {
    return this.value === undefined || this.value === null || this.value === "";
  }

  get displayValue() {
    return this.isEmpty ? "-" : this.value;
  }

  get valueClass() {
    return this.isEmpty
      ? "codify-kpi__value codify-kpi__value_unavailable"
      : "codify-kpi__value";
  }

  get resolvedSupportingText() {
    return this.isEmpty
      ? this.emptyMessage || this.supportingText
      : this.supportingText;
  }

  get showProgress() {
    return (
      !this.isEmpty && this.progress !== undefined && this.progress !== null
    );
  }

  get clampedProgress() {
    const n = Number(this.progress);
    if (!Number.isFinite(n)) {
      return 0;
    }
    return Math.min(Math.max(Math.round(n), 0), 100);
  }

  get progressAssistiveText() {
    return `${this.clampedProgress}% ${this.progressLabel || ""}`.trim();
  }

  get hasTrend() {
    return Boolean(this.trendLabel);
  }

  get trendIcon() {
    if (this.trendDirection === "up") {
      return "utility:arrowup";
    }
    if (this.trendDirection === "down") {
      return "utility:arrowdown";
    }
    return "utility:dash";
  }

  get loadingAssistiveText() {
    return `Loading ${this.label || "measure"}`;
  }
}
