import { LightningElement, api } from "lwc";

/**
 * The app's only skeleton implementation.
 *
 * Every variant is sized to the box the real content will occupy, which is the
 * whole point: a skeleton that is a different height to its loaded state trades
 * one bad experience (a blank card) for another (the page jumping under the
 * reader's cursor).
 *
 * Consumers pass a count and, where it matters, an explicit height so the
 * placeholder and the payload agree.
 */
const LINE_WIDTHS = ["100%", "92%", "78%", "86%", "64%"];

export default class CodifySkeletonLoader extends LightningElement {
  /** lines | rows | kpi | block */
  @api variant = "lines";

  /** Number of lines or rows to draw. */
  @api count = 3;

  /** Height of a single `block`, or of each `rows` row. Any CSS length. */
  @api height = "1rem";

  /** Announced to screen readers while the placeholder is on screen. */
  @api assistiveText = "Loading";

  get isKpi() {
    return this.variant === "kpi";
  }

  get isRows() {
    return this.variant === "rows";
  }

  get isBlock() {
    return this.variant === "block";
  }

  get safeCount() {
    const n = Number(this.count);
    return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), 40) : 3;
  }

  get items() {
    const rows = this.isRows;
    return Array.from({ length: this.safeCount }, (unused, i) => ({
      key: `sk-${i}`,
      style: rows
        ? `height:${this.height}`
        : `width:${LINE_WIDTHS[i % LINE_WIDTHS.length]}`
    }));
  }

  get blockStyle() {
    return `height:${this.height}`;
  }
}
