import { LightningElement, wire } from "lwc";
import getSummary from "@salesforce/apex/Codify_HomeDashboardController.getSummary";

/**
 * Codify Home.
 *
 * Deliberately not the usual grid of KPI tiles. Codify's claim is a pipeline —
 * a spoken fix becomes a tagged cause, becomes a draft, becomes published
 * knowledge — and the only question worth putting on a home page is where that
 * pipeline is leaking. So the page leads with the funnel, and every stage shows
 * its drop-off rather than just its count.
 *
 * The two numbers most dashboards would bury are given equal billing here:
 * recaps Codify refused to classify, and recurring causes with no article behind
 * them. Both are the system working as designed and both are work for a human,
 * which makes them the most actionable things on the page.
 */
export default class CodifyHomeDashboard extends LightningElement {
  summary;
  error;

  @wire(getSummary)
  wiredSummary({ data, error }) {
    if (data) {
      this.summary = data;
      this.error = undefined;
    } else if (error) {
      this.error = this.reduceError(error);
    }
  }

  get s() {
    return this.summary || {};
  }

  get hasData() {
    return (this.s.resolutionsAllTime || 0) > 0;
  }

  /**
   * The funnel. Widths are relative to the first stage so the drop-off is the
   * visual, not the numbers; a stage that loses most of its input looks like it.
   */
  get funnel() {
    const total = this.s.resolutionsAllTime || 0;
    const stages = [
      {
        key: "logged",
        label: "Fixes described",
        value: total,
        note: "technicians told Codify what they did"
      },
      {
        key: "tagged",
        label: "Root cause tagged",
        value: this.s.resolutionsTagged || 0,
        note: "confident enough to classify"
      },
      {
        key: "drafted",
        label: "Article drafted",
        value: (this.s.articlesPending || 0) + (this.s.articlesPublished || 0),
        note: "worth writing up"
      },
      {
        key: "published",
        label: "Published to knowledge",
        value: this.s.articlesPublished || 0,
        note: "a human reviewed and shipped it"
      }
    ];

    const max = total || 1;
    let previous = null;
    return stages.map((st) => {
      const pct = Math.round((st.value / max) * 100);
      const dropped = previous === null ? 0 : previous - st.value;
      const row = {
        ...st,
        style: `width:${Math.max(pct, st.value > 0 ? 4 : 0)}%`,
        pctLabel: `${pct}%`,
        barClass: `codify-funnel-bar codify-funnel-bar_${st.key}`,
        showDrop: dropped > 0,
        dropLabel: dropped > 0 ? `${dropped} did not reach this stage` : ""
      };
      previous = st.value;
      return row;
    });
  }

  get topRootCauses() {
    const rows = this.s.topRootCauses || [];
    const max = rows.reduce((m, r) => Math.max(m, r.count), 0) || 1;
    return rows.map((r) => ({
      label: r.label,
      count: r.count,
      style: `width:${Math.round((r.count / max) * 100)}%`
    }));
  }

  get hasRootCauses() {
    return (this.s.topRootCauses || []).length > 0;
  }

  get pendingReview() {
    return this.s.articlesPending || 0;
  }

  get escalations() {
    return this.s.escalations || 0;
  }

  get casesFlagged() {
    return this.s.casesFlagged || 0;
  }

  get resolutionsThisWeek() {
    return this.s.resolutionsThisWeek || 0;
  }

  get untagged() {
    return this.s.resolutionsUntagged || 0;
  }

  /**
   * The headline. States what the knowledge base gained, in a sentence, because
   * "12" on its own does not tell anyone whether the week went well.
   */
  get headline() {
    const n = this.resolutionsThisWeek;
    if (n === 0) {
      return "No fixes captured yet this week.";
    }
    const published = this.s.articlesPublished || 0;
    return `${n} fix${n === 1 ? "" : "es"} captured this week, from ${published} published article${published === 1 ? "" : "s"} standing behind them.`;
  }

  get subhead() {
    if (this.untagged === 0 && this.pendingReview === 0) {
      return "Nothing is waiting on a person right now.";
    }
    const bits = [];
    if (this.pendingReview > 0) {
      bits.push(
        `${this.pendingReview} draft${this.pendingReview === 1 ? "" : "s"} awaiting review`
      );
    }
    if (this.untagged > 0) {
      bits.push(
        `${this.untagged} recap${this.untagged === 1 ? "" : "s"} Codify would not classify`
      );
    }
    return bits.join(" · ");
  }

  // Trend rows, relative to the busiest day.
  get trend() {
    const raw = this.s.trend || [];
    const max = raw.reduce((m, t) => Math.max(m, t.count), 0) || 1;
    return raw.map((t, i) => ({
      key: `${t.label}-${i}`,
      label: t.label,
      count: t.count,
      style: `height:${Math.max(Math.round((t.count / max) * 100), 3)}%`
    }));
  }

  reduceError(error) {
    return error?.body?.message || error?.message || "Unknown error";
  }
}
