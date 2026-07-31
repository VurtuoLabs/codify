/**
 * Topic 2, Tag Root Cause. Classifies the fix against the configurable taxonomy
 * (Codify_Root_Cause_Taxonomy__mdt) and applies the tag to the Case.
 *
 * Usually this has already run as part of Log Resolution, so the common path
 * here is a technician correcting or supplying a cause after a clarifying
 * question. That is why an explicit override key is accepted: when a human tells
 * Codify what the cause was, the human wins over the classifier, and the audit
 * row records that the value came from the technician rather than from scoring.
 *
 * It will not tag from an ambiguous recap on its own. A wrong tag misdirects the
 * Related Case Sweep and suggests the wrong fix on other people's Cases, which
 * is worse than leaving the field blank.
 */
public with sharing class Codify_TagRootCauseInvocable {
  public class Request {
    @InvocableVariable(
      label='Case Id'
      required=true
      description='The Case to tag.'
    )
    public String caseId;

    @InvocableVariable(
      label='Resolution Log Id'
      description='The recap to classify from. Preferred, so the single cached extraction is reused.'
    )
    public String resolutionLogId;

    @InvocableVariable(
      label='Resolution Recap'
      description='Raw recap, used only when no resolution log id is available.'
    )
    public String resolutionRecap;

    @InvocableVariable(
      label='Root Cause Key'
      description='Explicit taxonomy key supplied by the technician. When present it overrides the classifier, because a human naming the cause beats keyword scoring.'
    )
    public String rootCauseKey;

    @InvocableVariable(label='Technician User Id')
    public String technicianUserId;
  }

  public class Response {
    @InvocableVariable
    public Boolean success;
    @InvocableVariable
    public Boolean tagged;
    @InvocableVariable
    public String rootCauseLabel;
    @InvocableVariable
    public String rootCauseKey;
    @InvocableVariable
    public Decimal confidence;
    @InvocableVariable
    public Boolean lowConfidence;
    @InvocableVariable
    public String candidates;
    @InvocableVariable
    public String summary;
  }

  @InvocableMethod(
    label='Codify: Tag Root Cause'
    description='Classifies the fix against the root cause taxonomy and tags the Case, or declines and says why.'
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
    r.tagged = false;

    Id technicianId = Codify_Util.toIdOrRunningUser(req.technicianUserId);
    Id caseId = Codify_Util.toIdOrNull(req.caseId);
    Id logId = Codify_Util.toIdOrNull(req.resolutionLogId);

    if (caseId == null) {
      r.success = false;
      r.summary = 'No valid Case id was supplied, so there was nothing to tag.';
      return r;
    }

    String resolvedKey;
    String resolvedLabel;
    Decimal confidence;
    Boolean fromTechnician = false;

    // A technician naming the cause outranks the classifier.
    if (String.isNotBlank(req.rootCauseKey)) {
      Codify_Root_Cause_Taxonomy__mdt row = Codify_ExtractionService.taxonomyByKey(
        req.rootCauseKey.trim()
      );
      if (row != null) {
        resolvedKey = row.Root_Cause_Key__c;
        resolvedLabel = row.Root_Cause_Label__c;
        confidence = 1;
        fromTechnician = true;
      } else {
        r.summary =
          'There is no root cause called "' +
          req.rootCauseKey +
          '" in this org\'s taxonomy, so nothing was tagged. Ask the technician to describe the cause instead of naming a category.';
        r.lowConfidence = true;
        return r;
      }
    } else {
      Codify_ResolutionParse parse = Codify_ExtractionService.resolve(
        logId,
        req.resolutionRecap
      );
      if (parse.hasRootCause()) {
        resolvedKey = parse.rootCause.key;
        resolvedLabel = parse.rootCause.label;
        confidence = parse.rootCause.score;
      } else {
        // Declining is a real outcome, not a failure. Report what it was
        // torn between so the agent can ask something specific.
        r.lowConfidence = true;
        r.confidence = 0;
        r.candidates = candidateList(parse);
        r.summary =
          'Not confident enough to tag a root cause. ' +
          parse.notes +
          (String.isBlank(r.candidates)
            ? ''
            : ' Closest candidates: ' + r.candidates + '.') +
          ' Ask the technician what the underlying cause was, or escalate for review. Do not guess.';
        return r;
      }
    }

    List<Case> cases = [
      SELECT Id, CaseNumber, Codify_Root_Cause__c, Codify_Root_Cause_Key__c
      FROM Case
      WHERE Id = :caseId
      WITH USER_MODE
      LIMIT 1
    ];
    if (cases.isEmpty()) {
      r.success = false;
      r.summary = 'That Case could not be found, so nothing was tagged.';
      return r;
    }

    Case c = cases[0];
    String oldLabel = c.Codify_Root_Cause__c;
    c.Codify_Root_Cause__c = resolvedLabel;
    c.Codify_Root_Cause_Key__c = resolvedKey;
    if (logId != null) {
      c.Codify_Source_Resolution_Log__c = logId;
    }
    c.Codify_Resolved_Via_Codify__c = true;
    update c;

    // Keep the resolution log consistent with the Case it produced.
    if (logId != null) {
      update new Codify_Resolution_Log__c(
        Id = logId,
        Root_Cause_Category__c = resolvedLabel,
        Root_Cause_Key__c = resolvedKey,
        Root_Cause_Confidence__c = confidence,
        Low_Confidence__c = false
      );
    }

    Codify_ChangeLogService.insertLogs(
      new List<Codify_Change_Log__c>{
        Codify_ChangeLogService.buildRootCauseTagged(
          c.Id,
          'Case ' + c.CaseNumber,
          oldLabel,
          resolvedLabel,
          logId,
          technicianId
        )
      }
    );

    r.tagged = true;
    r.rootCauseLabel = resolvedLabel;
    r.rootCauseKey = resolvedKey;
    r.confidence = confidence;
    r.lowConfidence = false;
    r.summary =
      'Tagged Case ' +
      c.CaseNumber +
      ' as "' +
      resolvedLabel +
      '"' +
      (fromTechnician
        ? ', as the technician described it.'
        : ' (confidence ' + confidence.setScale(2) + ').') +
      (String.isBlank(oldLabel) ? '' : ' Previous tag was "' + oldLabel + '".');
    return r;
  }

  private static String candidateList(Codify_ResolutionParse parse) {
    if (parse.runnersUp == null || parse.runnersUp.isEmpty()) {
      return '';
    }
    List<String> labels = new List<String>();
    for (Codify_ResolutionParse.RootCauseMatch m : parse.runnersUp) {
      labels.add(m.label);
    }
    return String.join(labels, ', ');
  }
}
