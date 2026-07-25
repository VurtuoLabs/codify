import { LightningElement, wire } from "lwc";
import getSummary from "@salesforce/apex/Codify_HomeDashboardController.getSummary";

/**
 * Codify Home.
 *
 * One card treatment for everything, so nothing is visually privileged and every
 * figure the controller returns appears somewhere. The pipeline is still the
 * story — described, tagged, drafted, published — but it reads as four
 * comparable cards, each measured against the first, rather than as a separate
 * full-width widget.
 *
 * Cards are assembled in JS rather than hand-written in the template so they stay
 * uniform by construction: same shape, same empty-state handling, and adding a
 * measure is one array entry instead of another bespoke block of markup.
 *
 * The numbers most dashboards would bury get equal billing: recaps Codify
 * refused to classify, and drafts still waiting on a person. Both are the system
 * working as designed, and both are work for a human.
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

  /** A value's share of every recap ever described, as a bar width and a label. */
  pctOf(value) {
    const total = this.s.resolutionsAllTime || 0;
    if (!total) {
      return { style: "width:0%", pctLabel: "—" };
    }
    const pct = Math.round((value / total) * 100);
    return {
      style: `width:${Math.max(pct, value > 0 ? 3 : 0)}%`,
      pctLabel: `${pct}% of all fixes described`
    };
  }

  /**
   * The pipeline as four comparable cards. Each carries its count, its share of
   * the first stage, and what it lost — the drop-off is the point, not the total.
   */
  get statCards() {
    const s = this.s;
    const described = s.resolutionsAllTime || 0;
    const tagged = s.resolutionsTagged || 0;
    const drafted = (s.articlesPending || 0) + (s.articlesPublished || 0);
    const published = s.articlesPublished || 0;
    const untagged = s.resolutionsUntagged || 0;
    const pending = s.articlesPending || 0;

    return [
      {
        key: "described",
        title: "Fixes described",
        value: described,
        barClass: "codify-bar codify-bar_described",
        ...this.pctOf(described),
        note: `${s.resolutionsThisWeek || 0} of them this week`
      },
      {
        key: "tagged",
        title: "Root cause tagged",
        value: tagged,
        barClass: "codify-bar codify-bar_tagged",
        ...this.pctOf(tagged),
        note:
          untagged > 0
            ? `${untagged} left unclassified on purpose`
            : "every recap classified"
      },
      {
        key: "drafted",
        title: "Articles drafted",
        value: drafted,
        barClass: "codify-bar codify-bar_drafted",
        ...this.pctOf(drafted),
        note:
          described - drafted > 0
            ? `${described - drafted} fixes did not warrant one`
            : "every fix warranted one"
      },
      {
        key: "published",
        title: "Published to knowledge",
        value: published,
        barClass: "codify-bar codify-bar_published",
        ...this.pctOf(published),
        note:
          pending > 0
            ? `${pending} still waiting on a reviewer`
            : "nothing waiting on a reviewer"
      }
    ];
  }

  /** Everything that needs a person, as one card of comparable rows. */
  get waitingRows() {
    const s = this.s;
    return [
      {
        key: "review",
        value: s.articlesPending || 0,
        label: "drafts to review before they go live",
        valueClass: "codify-row__num"
      },
      {
        key: "untagged",
        value: s.resolutionsUntagged || 0,
        label: "recaps Codify refused to classify rather than guess",
        valueClass: "codify-row__num codify-row__num_warn"
      },
      {
        key: "escalations",
        value: s.escalations || 0,
        label: "escalations raised this week",
        valueClass: "codify-row__num"
      },
      {
        key: "reach",
        value: s.casesFlagged || 0,
        label: "other open cases handed a suggested fix this week",
        valueClass: "codify-row__num codify-row__num_good"
      }
    ];
  }

  /** Shared shape for the ranked bar lists, so all three look identical. */
  toBars(rows) {
    const max = (rows || []).reduce((m, r) => Math.max(m, r.count), 0) || 1;
    return (rows || []).map((r) => ({
      label: r.label,
      count: r.count,
      style: `width:${Math.max(Math.round((r.count / max) * 100), 3)}%`
    }));
  }

  get rootCauseBars() {
    return this.toBars(this.s.topRootCauses);
  }

  get technicianBars() {
    return this.toBars(this.s.topTechnicians);
  }

  get changeTypeBars() {
    return this.toBars(this.s.byChangeType);
  }

  get hasRootCauses() {
    return this.rootCauseBars.length > 0;
  }

  get hasTechnicians() {
    return this.technicianBars.length > 0;
  }

  get hasChangeTypes() {
    return this.changeTypeBars.length > 0;
  }

  /** Seven zero-filled days, so a quiet day reads as quiet rather than absent. */
  get trend() {
    const raw = this.s.trend || [];
    const max = raw.reduce((m, t) => Math.max(m, t.count), 0) || 1;
    return raw.map((t, i) => ({
      key: `${t.label}-${i}`,
      label: t.label,
      count: t.count,
      style: `height:${Math.max(Math.round((t.count / max) * 100), 2)}%`
    }));
  }

  /**
   * States what the knowledge base gained, in a sentence. A bare count does not
   * tell anyone whether the week went well.
   */
  get headline() {
    const n = this.s.resolutionsThisWeek || 0;
    if (n === 0) {
      return "No fixes captured yet this week.";
    }
    const published = this.s.articlesPublished || 0;
    return `${n} fix${n === 1 ? "" : "es"} captured this week, with ${published} published article${published === 1 ? "" : "s"} standing behind them.`;
  }

  get subhead() {
    const pending = this.s.articlesPending || 0;
    const untagged = this.s.resolutionsUntagged || 0;
    if (pending === 0 && untagged === 0) {
      return "Nothing is waiting on a person right now.";
    }
    const bits = [];
    if (pending > 0) {
      bits.push(`${pending} draft${pending === 1 ? "" : "s"} awaiting review`);
    }
    if (untagged > 0) {
      bits.push(
        `${untagged} recap${untagged === 1 ? "" : "s"} Codify would not classify`
      );
    }
    return bits.join(" · ");
  }

  reduceError(error) {
    return error?.body?.message || error?.message || "Unknown error";
  }
}
