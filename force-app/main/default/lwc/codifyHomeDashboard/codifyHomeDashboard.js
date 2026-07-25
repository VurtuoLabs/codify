import { LightningElement, wire } from "lwc";
import getSummary from "@salesforce/apex/Codify_HomeDashboardController.getSummary";

/**
 * Codify Home.
 *
 * One card shape and one card size for everything, so nothing is visually
 * privileged and every figure the controller returns appears somewhere. The
 * pipeline is still the story — described, tagged, drafted, published — but it
 * reads as four comparable cards sitting in the same grid as the work still
 * waiting on a person, with no banner or summary line above them.
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

  /**
   * One card shape for every number on the page: value, a bar showing it against
   * a stated denominator, and a note. Building them from a single helper is what
   * keeps the boxes identical — there is no second layout to drift.
   */
  card(key, title, value, denom, denomLabel, note, tone) {
    const pct = denom > 0 ? Math.round((value / denom) * 100) : 0;
    return {
      key,
      title,
      value,
      // Capped so a figure that can legitimately exceed its denominator (cases
      // reached can outnumber fixes described) never overflows the track.
      style: `width:${Math.min(Math.max(pct, value > 0 ? 3 : 0), 100)}%`,
      meta: denom > 0 ? `${pct}% ${denomLabel}` : denomLabel,
      note,
      barClass: `codify-bar codify-bar_${tone}`,
      valueClass: `codify-card__value codify-card__value_${tone}`
    };
  }

  /**
   * The pipeline, then the work waiting on a person — eight cards in one shape.
   * The attention figures deliberately sit in the same grid as the successes
   * rather than in a panel of their own, because they are equally the point.
   */
  get statCards() {
    const s = this.s;
    const described = s.resolutionsAllTime || 0;
    const tagged = s.resolutionsTagged || 0;
    const pending = s.articlesPending || 0;
    const published = s.articlesPublished || 0;
    const drafted = pending + published;
    const untagged = s.resolutionsUntagged || 0;

    return [
      this.card(
        "described",
        "Fixes described",
        described,
        described,
        "captured so far",
        `${s.resolutionsThisWeek || 0} of them this week`,
        "described"
      ),
      this.card(
        "tagged",
        "Root cause tagged",
        tagged,
        described,
        "of fixes described",
        untagged > 0
          ? `${untagged} left unclassified on purpose`
          : "every recap classified",
        "tagged"
      ),
      this.card(
        "drafted",
        "Articles drafted",
        drafted,
        described,
        "of fixes described",
        described - drafted > 0
          ? `${described - drafted} fixes did not warrant one`
          : "every fix warranted one",
        "drafted"
      ),
      this.card(
        "published",
        "Published to knowledge",
        published,
        described,
        "of fixes described",
        pending > 0
          ? `${pending} still waiting on a reviewer`
          : "nothing waiting on a reviewer",
        "published"
      ),
      this.card(
        "review",
        "Drafts to review",
        pending,
        drafted,
        "of articles drafted",
        "not live until a person approves them",
        "warn"
      ),
      this.card(
        "untagged",
        "Left unclassified",
        untagged,
        described,
        "of fixes described",
        "refused rather than guessed at",
        "warn"
      ),
      this.card(
        "escalations",
        "Escalated this week",
        this.s.escalations || 0,
        described,
        "of fixes described",
        "handed to a human to finish",
        "warn"
      ),
      this.card(
        "reach",
        "Other cases reached",
        this.s.casesFlagged || 0,
        described,
        "of fixes described",
        "given a suggested fix, not resolved",
        "good"
      )
    ];
  }

  /** Shared shape for the ranked bar lists, so all three look identical. */
  toBars(rows) {
    // Capped at six so the three list cards cannot tower over the stat cards and
    // pull every row in the grid taller with them.
    const capped = (rows || []).slice(0, 6);
    const max = capped.reduce((m, r) => Math.max(m, r.count), 0) || 1;
    return capped.map((r) => ({
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

  reduceError(error) {
    return error?.body?.message || error?.message || "Unknown error";
  }
}
