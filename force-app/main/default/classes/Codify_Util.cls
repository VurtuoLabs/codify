/**
 * Small shared helpers for the invocables. Id coercion and text tidying that
 * degrade gracefully instead of throwing on the loose strings an agent passes.
 */
public with sharing class Codify_Util {
  /** Parse a string Id, returning null (not throwing) on blank/invalid input. */
  public static Id toIdOrNull(String value) {
    if (String.isBlank(value)) {
      return null;
    }
    try {
      return Id.valueOf(value.trim());
    } catch (Exception e) {
      return null;
    }
  }

  /** Parse a User Id, falling back to the running user when blank/invalid. */
  public static Id toIdOrRunningUser(String value) {
    Id parsed = toIdOrNull(value);
    return parsed != null ? parsed : UserInfo.getUserId();
  }

  /** True when the string is a syntactically valid Id for the given SObject type. */
  public static Boolean isIdOf(String value, SObjectType expected) {
    Id parsed = toIdOrNull(value);
    return parsed != null && parsed.getSObjectType() == expected;
  }

  /** Clip a string to a maximum length without throwing on null. */
  public static String clip(String value, Integer max) {
    if (value == null) {
      return null;
    }
    return value.length() > max ? value.substring(0, max) : value;
  }

  /** Split a comma-separated config string into trimmed, lowercased, non-empty tokens. */
  public static List<String> splitKeywords(String csv) {
    List<String> out = new List<String>();
    if (String.isBlank(csv)) {
      return out;
    }
    for (String part : csv.toLowerCase().split(',')) {
      String token = part.trim();
      if (token.length() > 0) {
        out.add(token);
      }
    }
    return out;
  }

  /**
   * Split raw text into sentences. Used by the extractor so a recap can be
   * bullets, a paragraph, or dictated stream-of-consciousness without the
   * technician having to learn a format.
   */
  public static List<String> splitSentences(String raw) {
    List<String> out = new List<String>();
    if (String.isBlank(raw)) {
      return out;
    }
    for (String part : raw.split('[\\.\\!\\?\\n;]')) {
      if (part != null && part.trim().length() > 0) {
        out.add(part.trim());
      }
    }
    return out;
  }

  /** Sentence-case a fragment and trim bullet characters, for readable summaries. */
  public static String tidySentence(String sentence) {
    if (String.isBlank(sentence)) {
      return '';
    }
    String s = sentence.trim().replaceFirst('^[\\-\\*\\u2022\\s]+', '');
    if (s.length() > 0) {
      s = s.substring(0, 1).toUpperCase() + s.substring(1);
    }
    return s;
  }
}
