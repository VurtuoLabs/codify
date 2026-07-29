import { LightningElement, api } from "lwc";

/**
 * A ranked bar list: label, a bar scaled against the largest value in the set,
 * and the figure itself.
 *
 * Deliberately quiet. There are no axes, gridlines, legends or tooltips, because
 * every one of those would be chrome around three data points per row. The bar
 * is a reading aid for the ordering; the number beside it is the data, which is
 * also why the bar is `aria-hidden` - a screen reader gets the label and value
 * without a redundant "graphic".
 */
export default class CodifyRankedBars extends LightningElement {
  /** [{ label, count }] - assumed already ordered by the caller. */
  @api rows = [];

  /** Cap on visible rows; the remainder is summarised underneath. */
  @api limit = 6;

  /** accent | good | pending | critical | ink */
  @api tone = "accent";

  @api loading = false;
  @api skeletonCount = 5;

  @api emptyIcon = "utility:chart";
  @api emptyTitle = "Nothing to rank yet";
  @api emptyMessage;

  /** Appended to each figure, e.g. " cases". */
  @api valueSuffix = "";

  get safeRows() {
    return Array.isArray(this.rows) ? this.rows : [];
  }

  get displayRows() {
    const capped = this.safeRows.slice(0, this.limit);
    const max = capped.reduce((m, r) => Math.max(m, Number(r.count) || 0), 0);
    return capped.map((r) => {
      const count = Number(r.count) || 0;
      // A non-zero value always gets a visible sliver, so "1" never looks like "0".
      const pct = max > 0 ? Math.round((count / max) * 100) : 0;
      return {
        label: r.label,
        display: `${count}${this.valueSuffix}`,
        style: `width:${count > 0 ? Math.max(pct, 4) : 0}%`
      };
    });
  }

  get hasRows() {
    return this.safeRows.length > 0;
  }

  get hiddenCount() {
    return Math.max(this.safeRows.length - this.limit, 0);
  }

  get hiddenLabel() {
    const n = this.hiddenCount;
    return `${n} more not shown`;
  }

  get barClass() {
    return `codify-ranked__bar codify-ranked__bar_${this.tone}`;
  }
}
