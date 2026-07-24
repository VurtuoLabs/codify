/**
 * The extraction/classification engine. Turns a free-form resolution recap into
 * one structured Codify_ResolutionParse. This is the ONLY place the raw text is
 * interpreted, so every topic gets identical, deterministic extraction.
 *
 * The design goal it exists to honor is "never invent a root cause". Every value
 * it returns traces to a literal cue in the recap, and the classifier requires
 * corroboration from at least two distinct taxonomy keywords before it will tag
 * anything. A single passing mention of "network" is not a diagnosis. When
 * nothing clears the floor it sets lowConfidence and names the runners-up, so
 * the agent can ask a real clarifying question instead of guessing, and so the
 * escalation Task tells a human what Codify was torn between.
 */
public with sharing class Codify_ExtractionService {
  /**
   * Distinct keyword hits needed for full confidence. Three is the saturation
   * ceiling, so two hits score 0.67 and clear the floor while one hit scores
   * 0.33 and does not. That asymmetry is the whole guardrail: corroboration is
   * required, a single incidental word is not enough to tag a Case.
   */
  private static final Decimal SCORE_SATURATION = 3;

  // Cues that a sentence describes the fix itself rather than the symptom.
  private static final Set<String> FIX_CUES = new Set<String>{
    'replaced',
    'swapped',
    'reset',
    'restarted',
    'rebooted',
    'reinstalled',
    'reconfigured',
    'updated',
    'upgraded',
    'flashed',
    'patched',
    'cleared',
    'cleaned',
    'tightened',
    'reseated',
    'recalibrated',
    'adjusted',
    'fixed',
    'resolved',
    'corrected',
    'restored',
    'rewired',
    'rerouted',
    'reconnected',
    'applied',
    'installed',
    'removed',
    'turned off',
    'turned on',
    'walked them through',
    'showed them',
    'set it to',
    'changed the'
  };

  // Cues that a sentence describes what was wrong, not what was done about it.
  private static final Set<String> SYMPTOM_CUES = new Set<String>{
    'reported',
    'complained',
    'was showing',
    'showing an',
    'error',
    'wouldn\'t',
    'would not',
    'failed to',
    'not working',
    'stopped working',
    'kept',
    'intermittent',
    'issue was',
    'problem was',
    'symptom',
    'customer said',
    'came in with',
    'no power',
    'no signal',
    'offline'
  };

  // Cues that the technician is describing a repeatable procedure worth writing up.
  private static final Set<String> PROCEDURE_CUES = new Set<String>{
    'first',
    'then',
    'after that',
    'next',
    'finally',
    'step',
    'once i',
    'before',
    'make sure',
    'you have to',
    'you need to',
    'the trick is',
    'turns out',
    'root cause was',
    'because'
  };

  /**
   * Parse a raw recap into structured data. The single entry point; everything
   * downstream reads the result rather than the text.
   */
  public static Codify_ResolutionParse parse(String rawRecap) {
    Codify_ResolutionParse result = new Codify_ResolutionParse();

    if (
      String.isBlank(rawRecap) ||
      rawRecap.trim().length() < Codify_Constants.MIN_RECAP_LENGTH
    ) {
      result.lowConfidence = true;
      result.notes = 'The recap was empty or too short to extract a resolution from.';
      result.articleWorthyReason = 'Not enough detail to draft anything a reviewer could use.';
      return result;
    }

    String lower = rawRecap.toLowerCase();
    List<String> sentences = Codify_Util.splitSentences(rawRecap);

    result.symptom = firstMatching(sentences, SYMPTOM_CUES);
    result.stepsTaken = allMatching(sentences, FIX_CUES);
    result.resolutionSummary = buildSummary(sentences, result);

    // Classify against the configurable taxonomy.
    List<Codify_ResolutionParse.RootCauseMatch> ranked = rankRootCauses(lower);
    if (
      !ranked.isEmpty() &&
      ranked[0].score >= Codify_Constants.ROOT_CAUSE_CONFIDENCE_FLOOR
    ) {
      result.rootCause = ranked[0];
      for (Integer i = 1; i < ranked.size() && i <= 2; i++) {
        result.runnersUp.add(ranked[i]);
      }
    } else {
      result.lowConfidence = true;
      result.notes = ranked.isEmpty()
        ? 'Nothing in the recap matched the root cause taxonomy.'
        : 'The strongest match (' +
          ranked[0].label +
          ') rested on a single keyword, which is not enough to tag a Case.';
      // Surface what it was torn between so the human escalation is actionable.
      for (Integer i = 0; i < ranked.size() && i < 3; i++) {
        result.runnersUp.add(ranked[i]);
      }
    }

    // Evidence: the verbatim sentences behind each conclusion.
    if (String.isNotBlank(result.symptom)) {
      result.evidence.add(
        new Codify_ResolutionParse.Evidence('symptom', result.symptom)
      );
    }
    for (String s : sentences) {
      if (containsAny(s.toLowerCase(), FIX_CUES)) {
        result.evidence.add(
          new Codify_ResolutionParse.Evidence(
            'summary',
            Codify_Util.tidySentence(s)
          )
        );
      }
    }
    if (result.hasRootCause()) {
      String cue = firstKeywordSentence(sentences, result.rootCause.key);
      if (String.isNotBlank(cue)) {
        result.evidence.add(
          new Codify_ResolutionParse.Evidence('rootCause', cue)
        );
      }
    }

    assessArticleWorthiness(result, rawRecap, lower);
    return result;
  }

  /**
   * Return the single parse for a recap, reusing the cached extraction on the
   * Resolution Log when available so downstream topics don't re-parse the text.
   * Falls back to parsing raw text (from the log or the passed recap) when no
   * cache exists. This is how "one recap, multiple outputs" is enforced in code.
   */
  public static Codify_ResolutionParse resolve(
    Id resolutionLogId,
    String recap
  ) {
    if (resolutionLogId != null) {
      List<Codify_Resolution_Log__c> logs = [
        SELECT Extraction_JSON__c, Resolution_Recap__c
        FROM Codify_Resolution_Log__c
        WHERE Id = :resolutionLogId
        LIMIT 1
      ];
      if (!logs.isEmpty()) {
        Codify_Resolution_Log__c log = logs[0];
        if (String.isNotBlank(log.Extraction_JSON__c)) {
          return Codify_ResolutionParse.fromJson(log.Extraction_JSON__c);
        }
        return parse(
          String.isBlank(log.Resolution_Recap__c)
            ? recap
            : log.Resolution_Recap__c
        );
      }
    }
    return parse(recap);
  }

  // ---- classification ----

  /**
   * Score every active taxonomy row against the recap and return them ranked.
   * Scoring counts DISTINCT keyword hits, not total occurrences, so repeating
   * one word in a rambling recap can't fake corroboration.
   */
  @TestVisible
  private static List<Codify_ResolutionParse.RootCauseMatch> rankRootCauses(
    String lower
  ) {
    List<Codify_ResolutionParse.RootCauseMatch> matches = new List<Codify_ResolutionParse.RootCauseMatch>();

    for (Codify_Root_Cause_Taxonomy__mdt row : loadTaxonomy()) {
      Integer hits = 0;
      for (String kw : Codify_Util.splitKeywords(row.Detection_Keywords__c)) {
        if (lower.contains(kw)) {
          hits++;
        }
      }
      if (hits == 0) {
        continue;
      }
      Codify_ResolutionParse.RootCauseMatch m = new Codify_ResolutionParse.RootCauseMatch();
      m.key = row.Root_Cause_Key__c;
      m.label = row.Root_Cause_Label__c;
      m.categoryGroup = row.Category_Group__c;
      m.hits = hits;
      Decimal score = Decimal.valueOf(hits) / SCORE_SATURATION;
      if (score > 1) {
        score = 1;
      }
      m.score = score.setScale(2);
      m.articleWorthy = row.Article_Worthy__c;
      m.relatedKeys = row.Related_Keys__c;
      matches.add(m);
    }

    // Highest score first; ties broken by hit count then by taxonomy sort order
    // (already applied by the query), giving deterministic output for the same input.
    for (Integer i = 0; i < matches.size(); i++) {
      for (Integer j = i + 1; j < matches.size(); j++) {
        Boolean swap =
          matches[j].score > matches[i].score ||
          (matches[j].score == matches[i].score &&
          matches[j].hits > matches[i].hits);
        if (swap) {
          Codify_ResolutionParse.RootCauseMatch tmp = matches[i];
          matches[i] = matches[j];
          matches[j] = tmp;
        }
      }
    }
    return matches;
  }

  /** Active taxonomy rows, ordered. Test-injectable so tests never depend on org config. */
  @TestVisible
  private static List<Codify_Root_Cause_Taxonomy__mdt> testTaxonomy;

  public static List<Codify_Root_Cause_Taxonomy__mdt> loadTaxonomy() {
    if (testTaxonomy != null) {
      List<Codify_Root_Cause_Taxonomy__mdt> active = new List<Codify_Root_Cause_Taxonomy__mdt>();
      for (Codify_Root_Cause_Taxonomy__mdt r : testTaxonomy) {
        if (r.Is_Active__c) {
          active.add(r);
        }
      }
      return active;
    }
    return [
      SELECT
        Root_Cause_Key__c,
        Root_Cause_Label__c,
        Category_Group__c,
        Detection_Keywords__c,
        Article_Worthy__c,
        Related_Keys__c,
        Sort_Order__c,
        Is_Active__c
      FROM Codify_Root_Cause_Taxonomy__mdt
      WHERE Is_Active__c = TRUE
      ORDER BY Sort_Order__c ASC NULLS LAST
    ];
  }

  /**
   * Keys the sweep should consider "the same or closely related": the cause
   * itself, its configured neighbours, and anything in the same category group.
   */
  public static Set<String> relatedKeysFor(String rootCauseKey) {
    Set<String> keys = new Set<String>();
    if (String.isBlank(rootCauseKey)) {
      return keys;
    }
    keys.add(rootCauseKey);

    String categoryGroup;
    for (Codify_Root_Cause_Taxonomy__mdt row : loadTaxonomy()) {
      if (row.Root_Cause_Key__c == rootCauseKey) {
        categoryGroup = row.Category_Group__c;
        keys.addAll(Codify_Util.splitKeywords(row.Related_Keys__c));
      }
    }
    if (String.isNotBlank(categoryGroup)) {
      for (Codify_Root_Cause_Taxonomy__mdt row : loadTaxonomy()) {
        if (row.Category_Group__c == categoryGroup) {
          keys.add(row.Root_Cause_Key__c);
        }
      }
    }

    // splitKeywords lowercases; restore the configured casing of real keys.
    Set<String> normalized = new Set<String>();
    for (Codify_Root_Cause_Taxonomy__mdt row : loadTaxonomy()) {
      if (
        keys.contains(row.Root_Cause_Key__c) ||
        keys.contains(row.Root_Cause_Key__c.toLowerCase())
      ) {
        normalized.add(row.Root_Cause_Key__c);
      }
    }
    normalized.add(rootCauseKey);
    return normalized;
  }

  /** Look up a taxonomy row by key, or null. */
  public static Codify_Root_Cause_Taxonomy__mdt taxonomyByKey(String key) {
    if (String.isBlank(key)) {
      return null;
    }
    for (Codify_Root_Cause_Taxonomy__mdt row : loadTaxonomy()) {
      if (row.Root_Cause_Key__c == key) {
        return row;
      }
    }
    return null;
  }

  // ---- article worthiness ----

  /**
   * Decide whether this recap justifies a Knowledge draft. Two things have to be
   * true: the root cause is one the org considers worth documenting, and the
   * recap actually contains a reusable procedure. A confident diagnosis with no
   * described steps makes a useless article, so it is not drafted.
   */
  @TestVisible
  private static void assessArticleWorthiness(
    Codify_ResolutionParse result,
    String raw,
    String lower
  ) {
    if (!result.hasRootCause()) {
      result.articleWorthy = false;
      result.articleWorthyReason = 'No confident root cause, so there is nothing reliable to document.';
      return;
    }
    if (result.rootCause.articleWorthy == false) {
      result.articleWorthy = false;
      result.articleWorthyReason =
        'Fixes tagged "' +
        result.rootCause.label +
        '" are one-off by nature and are not usually worth a reusable article.';
      return;
    }
    Boolean hasSteps = String.isNotBlank(result.stepsTaken);
    Boolean hasProcedure = containsAny(lower, PROCEDURE_CUES);
    Boolean longEnough = raw.trim().length() >= 120;

    if (hasSteps && (hasProcedure || longEnough)) {
      result.articleWorthy = true;
      result.articleWorthyReason = 'The recap names a repeatable cause and the steps that fixed it.';
    } else {
      result.articleWorthy = false;
      result.articleWorthyReason = hasSteps
        ? 'The fix is described but too briefly to make an article someone else could follow.'
        : 'The recap identifies a cause but never says what was actually done about it.';
    }
  }

  // ---- text helpers ----

  /**
   * Build the resolution summary from the fix sentences, falling back to the
   * whole recap. Never paraphrases beyond trimming and sentence-casing, so what
   * lands on the Case is still recognisably the technician's own words.
   */
  private static String buildSummary(
    List<String> sentences,
    Codify_ResolutionParse result
  ) {
    if (String.isNotBlank(result.stepsTaken)) {
      return Codify_Util.clip(result.stepsTaken, 32000);
    }
    List<String> kept = new List<String>();
    for (String s : sentences) {
      kept.add(Codify_Util.tidySentence(s));
    }
    return Codify_Util.clip(String.join(kept, '. '), 32000);
  }

  private static String firstMatching(
    List<String> sentences,
    Set<String> cues
  ) {
    for (String s : sentences) {
      if (containsAny(s.toLowerCase(), cues)) {
        return Codify_Util.tidySentence(s);
      }
    }
    return '';
  }

  private static String allMatching(List<String> sentences, Set<String> cues) {
    List<String> hits = new List<String>();
    for (String s : sentences) {
      if (containsAny(s.toLowerCase(), cues)) {
        hits.add(Codify_Util.tidySentence(s));
      }
    }
    return String.join(hits, '. ');
  }

  /** The first sentence carrying a keyword for the given taxonomy key. */
  private static String firstKeywordSentence(
    List<String> sentences,
    String rootCauseKey
  ) {
    Codify_Root_Cause_Taxonomy__mdt row = taxonomyByKey(rootCauseKey);
    if (row == null) {
      return '';
    }
    List<String> keywords = Codify_Util.splitKeywords(
      row.Detection_Keywords__c
    );
    for (String s : sentences) {
      String ls = s.toLowerCase();
      for (String kw : keywords) {
        if (ls.contains(kw)) {
          return Codify_Util.tidySentence(s);
        }
      }
    }
    return '';
  }

  private static Boolean containsAny(String lower, Set<String> cues) {
    for (String cue : cues) {
      if (lower.contains(cue)) {
        return true;
      }
    }
    return false;
  }
}
