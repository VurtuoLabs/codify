/**
 * Topic 1, Log Resolution. The entry point for every interaction.
 *
 * The technician recaps what fixed the issue; this captures the recap as a
 * permanent Codify_Resolution_Log__c, caches the single extraction every other
 * topic reuses, and writes the resolution summary onto the Case. Case resolution
 * fields apply directly rather than through a confirmation gate: they are
 * internal record-keeping on the record being closed, not a customer-facing
 * artifact, so the risk of writing them is low and the friction of confirming
 * every one would defeat the "under a minute" goal.
 *
 * Root cause tagging runs here too when the classifier is confident, because the
 * brief calls for one recap producing several outputs rather than making the
 * technician ask three times.
 */
public with sharing class Codify_LogResolutionInvocable {
  public class Request {
    @InvocableVariable(
      label='Resolution Recap'
      required=true
      description='The technician\'s raw recap of how the Case was fixed, dictated or pasted.'
    )
    public String resolutionRecap;

    @InvocableVariable(
      label='Case Id'
      description='The Case this fix resolved.'
    )
    public String caseId;

    @InvocableVariable(
      label='Technician User Id'
      description='Who described the fix. Defaults to the running user.'
    )
    public String technicianUserId;

    @InvocableVariable(
      label='Source Channel'
      description='Internal Agent Console or Dictation. Defaults to Internal Agent Console.'
    )
    public String sourceChannel;

    @InvocableVariable(
      label='Tag Root Cause'
      description='Whether to apply the root cause tag in the same pass. Defaults to true so one recap produces several outputs.'
    )
    public Boolean tagRootCause;
  }

  public class Response {
    @InvocableVariable
    public Boolean success;
    @InvocableVariable
    public String resolutionLogId;
    @InvocableVariable
    public String resolutionLogName;
    @InvocableVariable
    public String resolutionSummary;
    @InvocableVariable
    public String rootCauseLabel;
    @InvocableVariable
    public String rootCauseKey;
    @InvocableVariable
    public Boolean rootCauseTagged;
    @InvocableVariable
    public Boolean articleWorthy;
    @InvocableVariable
    public Boolean lowConfidence;
    @InvocableVariable
    public String clarifyingQuestion;
    @InvocableVariable
    public String summary;
  }

  @InvocableMethod(
    label='Codify: Log Resolution'
    description='Captures how the Case was fixed, writes the resolution to the Case, and caches the single extraction every other topic reuses.'
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
    Id technicianId = Codify_Util.toIdOrRunningUser(req.technicianUserId);
    Id caseId = Codify_Util.toIdOrNull(req.caseId);
    Boolean shouldTag = req.tagRootCause == null ? true : req.tagRootCause;

    Codify_ResolutionParse parse = Codify_ExtractionService.parse(
      req.resolutionRecap
    );

    // 1. Always persist the recap, even a thin one. The raw text is the audit
    //    trail and the thing a reviewer compares a draft against; losing it
    //    because the classifier was unsure would defeat the point.
    Codify_Resolution_Log__c log = new Codify_Resolution_Log__c(
      Case__c = caseId,
      Resolution_Recap__c = req.resolutionRecap,
      Resolution_Summary__c = parse.resolutionSummary,
      Root_Cause_Category__c = parse.hasRootCause()
        ? parse.rootCause.label
        : null,
      Root_Cause_Key__c = parse.hasRootCause() ? parse.rootCause.key : null,
      Root_Cause_Confidence__c = parse.hasRootCause()
        ? parse.rootCause.score
        : 0,
      Logged_By_Technician__c = technicianId,
      Source_Channel__c = String.isBlank(req.sourceChannel)
        ? 'Internal Agent Console'
        : req.sourceChannel,
      Low_Confidence__c = parse.lowConfidence,
      Article_Drafted__c = false,
      Related_Cases_Flagged__c = 0,
      Extraction_JSON__c = parse.toJsonString()
    );
    insert log;

    List<Codify_Change_Log__c> audit = new List<Codify_Change_Log__c>{
      Codify_ChangeLogService.buildResolutionLogged(log, technicianId)
    };

    // 2. Write the resolution onto the Case, capturing before/after per field.
    if (caseId != null) {
      List<Case> cases = [
        SELECT
          Id,
          CaseNumber,
          Subject,
          Codify_Resolution_Summary__c,
          Codify_Root_Cause__c,
          Codify_Root_Cause_Key__c
        FROM Case
        WHERE Id = :caseId
        WITH USER_MODE
        LIMIT 1
      ];
      if (!cases.isEmpty()) {
        Case c = cases[0];
        String caseName = 'Case ' + c.CaseNumber;
        Boolean dirty = false;

        if (String.isNotBlank(parse.resolutionSummary)) {
          audit.add(
            Codify_ChangeLogService.buildCaseFieldUpdate(
              c.Id,
              caseName,
              'Codify_Resolution_Summary__c',
              c.Codify_Resolution_Summary__c,
              parse.resolutionSummary,
              log.Id,
              technicianId
            )
          );
          c.Codify_Resolution_Summary__c = parse.resolutionSummary;
          dirty = true;
        }

        // Only tag when the classifier actually cleared the confidence floor.
        if (shouldTag && parse.hasRootCause()) {
          audit.add(
            Codify_ChangeLogService.buildRootCauseTagged(
              c.Id,
              caseName,
              c.Codify_Root_Cause__c,
              parse.rootCause.label,
              log.Id,
              technicianId
            )
          );
          c.Codify_Root_Cause__c = parse.rootCause.label;
          c.Codify_Root_Cause_Key__c = parse.rootCause.key;
          r.rootCauseTagged = true;
          dirty = true;
        }

        if (dirty) {
          c.Codify_Resolved_Via_Codify__c = true;
          c.Codify_Source_Resolution_Log__c = log.Id;
          update c;
        }
      }
    }

    Codify_ChangeLogService.insertLogs(audit);

    r.success = true;
    r.resolutionLogId = log.Id;
    r.resolutionLogName = log.Name;
    r.resolutionSummary = parse.resolutionSummary;
    r.rootCauseLabel = parse.hasRootCause() ? parse.rootCause.label : null;
    r.rootCauseKey = parse.hasRootCause() ? parse.rootCause.key : null;
    r.rootCauseTagged = r.rootCauseTagged == true;
    r.articleWorthy = parse.articleWorthy;
    r.lowConfidence = parse.lowConfidence;
    r.clarifyingQuestion = parse.lowConfidence
      ? clarifyingQuestion(parse)
      : null;
    r.summary = buildSummary(log, parse, r.rootCauseTagged);
    return r;
  }

  /**
   * When the classifier can't commit, ask something specific rather than
   * "can you add more detail?". Naming the candidates it was torn between turns
   * a vague reprompt into a question the technician can answer in five seconds.
   */
  private static String clarifyingQuestion(Codify_ResolutionParse parse) {
    if (parse.runnersUp != null && !parse.runnersUp.isEmpty()) {
      List<String> labels = new List<String>();
      for (Codify_ResolutionParse.RootCauseMatch m : parse.runnersUp) {
        labels.add(m.label);
      }
      return 'I could not tell whether this was ' +
        String.join(labels, ' or ') +
        '. What was the underlying cause, in your own words?';
    }
    return 'What was the underlying cause here, and what did you actually do to fix it?';
  }

  private static String buildSummary(
    Codify_Resolution_Log__c log,
    Codify_ResolutionParse parse,
    Boolean tagged
  ) {
    String s = 'Logged ' + log.Name + '.';
    if (String.isNotBlank(parse.resolutionSummary)) {
      s += ' Wrote the resolution summary to the Case.';
    }
    if (tagged) {
      s += ' Tagged the root cause as "' + parse.rootCause.label + '".';
    } else if (parse.lowConfidence) {
      s +=
        ' NOTE: the recap was too thin to tag a root cause confidently (' +
        parse.notes +
        '). Ask a clarifying question, and if the technician cannot add detail, escalate for review rather than guessing.';
    }
    if (parse.articleWorthy) {
      s +=
        ' This looks worth a Knowledge article: ' + parse.articleWorthyReason;
    } else {
      s += ' No article warranted: ' + parse.articleWorthyReason;
    }
    return s;
  }
}
