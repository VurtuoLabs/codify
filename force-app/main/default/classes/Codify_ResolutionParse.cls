/**
 * The single structured parse of a resolution recap. Produced once by
 * Codify_ExtractionService and consumed by every topic's action, so all of them
 * reason over identical extracted data rather than re-parsing the recap several
 * different (and possibly inconsistent) ways.
 *
 * This DTO is intentionally serializable to JSON so it can be cached on
 * Codify_Resolution_Log__c.Extraction_JSON__c at log time. That cache is what
 * makes "one recap, multiple outputs" true in code and not just in the pitch.
 */
public class Codify_ResolutionParse {
  /** A scored candidate from the root cause taxonomy. */
  public class RootCauseMatch {
    public String key; // Stable taxonomy key, what the sweep matches on.
    public String label; // Display label shown to humans.
    public String categoryGroup; // Coarse grouping, used for "closely related".
    public Decimal score; // 0-1 confidence, matched keywords over a saturation ceiling.
    public Integer hits; // How many distinct keywords matched.
    public Boolean articleWorthy; // Whether this cause usually warrants an article.
    public String relatedKeys; // Comma-separated neighbouring keys for the sweep.

    public RootCauseMatch() {
    }
  }

  /** The verbatim sentence a conclusion traces to. Kept so nothing is unattributable. */
  public class Evidence {
    public String forField; // Which output this supports: 'summary', 'rootCause', 'symptom'.
    public String text; // The technician's own words.

    public Evidence() {
    }
    public Evidence(String forField, String text) {
      this.forField = forField;
      this.text = text;
    }
  }

  public String resolutionSummary = ''; // The cleaned-up statement of what fixed it.
  public String symptom = ''; // What was reported/observed, when the recap says.
  public String stepsTaken = ''; // The fix steps, in the technician's order.
  public RootCauseMatch rootCause; // Best-scoring taxonomy match, null when none cleared the floor.
  public List<RootCauseMatch> runnersUp = new List<RootCauseMatch>(); // Next-best candidates, for the escalation note.
  public Boolean articleWorthy = false; // Whether a Knowledge draft is warranted from this recap.
  public String articleWorthyReason = ''; // Why, or why not, in plain language.
  public List<Evidence> evidence = new List<Evidence>(); // Verbatim support for each conclusion.
  public Boolean lowConfidence = false; // True when the recap was too thin to classify.
  public String notes = ''; // Why it was low-confidence, for graceful degradation.

  public String toJsonString() {
    return JSON.serialize(this);
  }

  public static Codify_ResolutionParse fromJson(String jsonStr) {
    if (String.isBlank(jsonStr)) {
      return new Codify_ResolutionParse();
    }
    try {
      return (Codify_ResolutionParse) JSON.deserialize(
        jsonStr,
        Codify_ResolutionParse.class
      );
    } catch (Exception e) {
      // A malformed cache should degrade to "no extraction", never break the topic.
      return new Codify_ResolutionParse();
    }
  }

  /** Convenience for callers that only care whether a usable root cause came out. */
  public Boolean hasRootCause() {
    return rootCause != null && String.isNotBlank(rootCause.key);
  }
}
