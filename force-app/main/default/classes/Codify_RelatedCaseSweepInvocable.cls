/**
 * Topic 4, Related Case Sweep. Finds other OPEN Cases tagged with the same or a
 * closely related root cause and flags them with this resolution as a suggested
 * fix, so one diagnosis helps clear a backlog instead of only the Case in front
 * of the technician.
 *
 * Two deliberate limits. First, it writes to a suggestion field and never to the
 * other Cases' resolution fields: those Cases belong to other people, they have
 * not been diagnosed, and silently "resolving" them would be indefensible.
 * Second, it refuses to run without a confident root cause, because an incorrect
 * tag here does not just mislabel one record, it pushes the wrong fix onto every
 * Case it touches. That is exactly the failure the confidence floor exists to
 * prevent, so the guard is re-checked at the point of blast radius, not just at
 * the point of classification.
 */
public with sharing class Codify_RelatedCaseSweepInvocable {
  public class Request {
    @InvocableVariable(
      label='Resolution Log Id'
      required=true
      description='The recap whose fix is being suggested.'
    )
    public String resolutionLogId;

    @InvocableVariable(
      label='Case Id'
      description='The Case just resolved. Excluded from its own sweep.'
    )
    public String caseId;

    @InvocableVariable(
      label='Root Cause Key'
      description='Override for the key to sweep on. Defaults to the key on the resolution log.'
    )
    public String rootCauseKey;

    @InvocableVariable(
      label='Include Related Causes'
      description='Whether to include closely related root causes as well as exact matches. Defaults to true.'
    )
    public Boolean includeRelated;

    @InvocableVariable(label='Technician User Id')
    public String technicianUserId;
  }

  public class Response {
    @InvocableVariable
    public Boolean success;
    @InvocableVariable
    public Integer casesFlagged;
    @InvocableVariable
    public String caseNumbers;
    @InvocableVariable
    public String rootCauseLabel;
    @InvocableVariable
    public Boolean skipped;
    @InvocableVariable
    public String summary;
  }

  @InvocableMethod(
    label='Codify: Related Case Sweep'
    description='Flags other open Cases sharing this root cause with the new resolution as a suggested fix.'
  )
  public static List<Response> run(List<Request> requests) {
    List<Response> out = new List<Response>();
    for (Request req : requests) {
      out.add(handle(req));
    }
    return out;
  }

  private static Response handle(Request req) {
    Response r = new Response();
    r.success = true;
    r.casesFlagged = 0;
    r.skipped = false;

    Id technicianId = Codify_Util.toIdOrRunningUser(req.technicianUserId);
    Id logId = Codify_Util.toIdOrNull(req.resolutionLogId);
    if (logId == null) {
      r.success = false;
      r.summary = 'No valid resolution log id was supplied, so there was nothing to sweep from.';
      return r;
    }

    List<Codify_Resolution_Log__c> logs = [
      SELECT
        Id,
        Name,
        Case__c,
        Case__r.CaseNumber,
        Root_Cause_Key__c,
        Root_Cause_Category__c,
        Root_Cause_Confidence__c,
        Resolution_Summary__c,
        Low_Confidence__c
      FROM Codify_Resolution_Log__c
      WHERE Id = :logId
      LIMIT 1
    ];
    if (logs.isEmpty()) {
      r.success = false;
      r.summary = 'That resolution log could not be found.';
      return r;
    }
    Codify_Resolution_Log__c log = logs[0];

    String key = String.isNotBlank(req.rootCauseKey)
      ? req.rootCauseKey.trim()
      : log.Root_Cause_Key__c;

    // The blast-radius guard. No confident cause means no sweep, full stop.
    if (String.isBlank(key) || log.Low_Confidence__c == true) {
      r.skipped = true;
      r.summary =
        'Skipped the sweep: there is no confident root cause on ' +
        log.Name +
        '. Suggesting a fix on other people\'s open Cases from an uncertain diagnosis would spread the wrong fix, ' +
        'so tag the root cause first or escalate for review.';
      return r;
    }

    Boolean includeRelated = req.includeRelated == null
      ? true
      : req.includeRelated;
    Set<String> keys = includeRelated
      ? Codify_ExtractionService.relatedKeysFor(key)
      : new Set<String>{ key };

    Id excludeCaseId = Codify_Util.toIdOrNull(req.caseId) != null
      ? Codify_Util.toIdOrNull(req.caseId)
      : log.Case__c;

    Integer maxCases = Codify_Constants.MAX_SWEEP_CASES;
    // Filtered on the source field rather than the suggestion itself: long
    // text areas are not filterable in SOQL, and the source is written in the
    // same breath as the suggestion, so it is an exact proxy for "already
    // flagged" and keeps a re-run from overwriting an earlier suggestion.
    List<Case> candidates = [
      SELECT Id, CaseNumber, Subject, Codify_Root_Cause__c
      FROM Case
      WHERE
        IsClosed = FALSE
        AND Codify_Root_Cause_Key__c IN :keys
        AND Id != :excludeCaseId
        AND Codify_Suggested_Fix_Source__c = NULL
      ORDER BY CreatedDate ASC
      LIMIT :maxCases
    ];

    if (candidates.isEmpty()) {
      r.rootCauseLabel = log.Root_Cause_Category__c;
      r.summary =
        'No other open Cases are tagged with "' +
        log.Root_Cause_Category__c +
        '" or a closely related cause, so there was nothing to flag. This fix resolved an isolated issue.';
      return r;
    }

    String suggestion = buildSuggestion(log);
    List<Codify_Change_Log__c> audit = new List<Codify_Change_Log__c>();
    List<String> numbers = new List<String>();

    for (Case c : candidates) {
      c.Codify_Suggested_Fix__c = suggestion;
      c.Codify_Suggested_Fix_Source__c = log.Case__r == null
        ? log.Name
        : 'Case ' + log.Case__r.CaseNumber;
      numbers.add(c.CaseNumber);
      audit.add(
        Codify_ChangeLogService.buildRelatedCaseFlagged(
          c.Id,
          'Case ' + c.CaseNumber,
          suggestion,
          log.Id,
          technicianId
        )
      );
    }

    update candidates;
    update new Codify_Resolution_Log__c(
      Id = log.Id,
      Related_Cases_Flagged__c = candidates.size()
    );
    Codify_ChangeLogService.insertLogs(audit);

    r.casesFlagged = candidates.size();
    r.caseNumbers = String.join(numbers, ', ');
    r.rootCauseLabel = log.Root_Cause_Category__c;
    r.summary =
      'Flagged ' +
      candidates.size() +
      ' other open Case' +
      (candidates.size() == 1 ? '' : 's') +
      ' sharing this root cause with the fix as a suggestion: ' +
      r.caseNumbers +
      '. Their owners still decide whether it applies, nothing on those Cases was resolved.';
    return r;
  }

  private static String buildSuggestion(Codify_Resolution_Log__c log) {
    String source = log.Case__r == null
      ? log.Name
      : 'Case ' + log.Case__r.CaseNumber;
    return Codify_Util.clip(
      'Suggested fix from ' +
        source +
        ', which was resolved with the same root cause (' +
        log.Root_Cause_Category__c +
        '):\n\n' +
        log.Resolution_Summary__c +
        '\n\nThis is a suggestion from Codify based on a matching diagnosis, not a confirmed fix for this Case.',
      32000
    );
  }
}
