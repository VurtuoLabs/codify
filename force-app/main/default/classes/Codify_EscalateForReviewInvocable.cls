/**
 * Topic 5, Escalate for Review. The safety valve.
 *
 * When a recap does not give Codify enough confidence to tag a root cause or
 * draft anything meaningful, this is what it does instead of forcing a
 * low-confidence classification: it says so plainly and creates a Task for a
 * Knowledge or Support Ops owner to follow up.
 *
 * The Task carries the technician's verbatim recap and the candidates the
 * classifier was torn between, because the point is to make the human's job
 * small. "Codify could not classify this" is not useful on its own; "Codify was
 * torn between Network Connectivity and Power Supply, here is exactly what the
 * technician said" is something a person can resolve in under a minute.
 */
public with sharing class Codify_EscalateForReviewInvocable {
  public class Request {
    @InvocableVariable(
      label='Resolution Log Id'
      description='The recap that could not be classified. The Task links back to it.'
    )
    public String resolutionLogId;

    @InvocableVariable(
      label='Case Id'
      description='The Case being closed, so the Task hangs off the right record.'
    )
    public String caseId;

    @InvocableVariable(
      label='Reason'
      description='Why Codify could not proceed, in plain language. Written onto the Task so the reviewer is not guessing.'
    )
    public String reason;

    @InvocableVariable(
      label='Owner User Id'
      description='Who should follow up. Defaults to the Case owner, then to the running user, so the Task is never orphaned.'
    )
    public String ownerUserId;

    @InvocableVariable(label='Technician User Id')
    public String technicianUserId;
  }

  public class Response {
    @InvocableVariable
    public Boolean success;
    @InvocableVariable
    public String taskId;
    @InvocableVariable
    public String taskSubject;
    @InvocableVariable
    public String summary;
  }

  @InvocableMethod(
    label='Codify: Escalate for Review'
    description='Creates a follow-up Task for a Knowledge or Support Ops owner when the recap is too thin to classify.'
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
    Id logId = Codify_Util.toIdOrNull(req.resolutionLogId);
    Id caseId = Codify_Util.toIdOrNull(req.caseId);

    Codify_Resolution_Log__c log;
    if (logId != null) {
      List<Codify_Resolution_Log__c> logs = [
        SELECT
          Id,
          Name,
          Case__c,
          Case__r.CaseNumber,
          Resolution_Recap__c,
          Extraction_JSON__c
        FROM Codify_Resolution_Log__c
        WHERE Id = :logId
        WITH USER_MODE
        LIMIT 1
      ];
      if (!logs.isEmpty()) {
        log = logs[0];
        if (caseId == null) {
          caseId = log.Case__c;
        }
      }
    }

    // Prefer the Case owner: they already have context on the issue.
    Id ownerId = Codify_Util.toIdOrNull(req.ownerUserId);
    String caseNumber;
    if (caseId != null) {
      List<Case> cases = [
        SELECT Id, CaseNumber, OwnerId
        FROM Case
        WHERE Id = :caseId
        WITH USER_MODE
        LIMIT 1
      ];
      if (!cases.isEmpty()) {
        caseNumber = cases[0].CaseNumber;
        if (
          ownerId == null &&
          cases[0].OwnerId.getSObjectType() == User.SObjectType
        ) {
          ownerId = cases[0].OwnerId;
        }
      }
    }
    if (ownerId == null) {
      ownerId = technicianId;
    }

    String subject =
      'Codify: resolution needs a human review' +
      (String.isBlank(caseNumber) ? '' : ' (Case ' + caseNumber + ')');

    Task t = new Task(
      Subject = Codify_Util.clip(subject, 255),
      Description = buildDescription(req.reason, log),
      OwnerId = ownerId,
      WhatId = caseId,
      ActivityDate = Date.today().addDays(Codify_Constants.ESCALATION_DUE_DAYS),
      Priority = 'Normal',
      Status = 'Not Started'
    );
    insert t;

    if (logId != null) {
      update new Codify_Resolution_Log__c(Id = logId, Low_Confidence__c = true);
    }

    Codify_ChangeLogService.insertLogs(
      new List<Codify_Change_Log__c>{
        Codify_ChangeLogService.buildEscalated(
          t.Id,
          subject,
          String.isBlank(req.reason)
            ? 'Recap too thin to classify confidently.'
            : req.reason,
          logId,
          technicianId
        )
      }
    );

    r.success = true;
    r.taskId = t.Id;
    r.taskSubject = subject;
    r.summary =
      'Created a follow-up task for a human reviewer, due in ' +
      Codify_Constants.ESCALATION_DUE_DAYS +
      ' days, with the recap attached. Tell the technician plainly that you could not classify this one confidently ' +
      'and that a person will pick it up, rather than implying it was handled.';
    return r;
  }

  /**
   * Give the reviewer everything they need in the Task itself: why Codify
   * stopped, what it was torn between, and the technician's own words.
   */
  private static String buildDescription(
    String reason,
    Codify_Resolution_Log__c log
  ) {
    List<String> parts = new List<String>();
    parts.add(
      'Codify could not confidently classify this resolution and did not tag a root cause or draft an article.'
    );
    parts.add('');
    parts.add(
      'Why: ' +
      (String.isBlank(reason)
        ? 'The recap was too thin to classify.'
        : reason.trim())
    );

    if (log != null) {
      Codify_ResolutionParse parse = Codify_ResolutionParse.fromJson(
        log.Extraction_JSON__c
      );
      if (parse.runnersUp != null && !parse.runnersUp.isEmpty()) {
        List<String> labels = new List<String>();
        for (Codify_ResolutionParse.RootCauseMatch m : parse.runnersUp) {
          labels.add(m.label + ' (score ' + m.score + ')');
        }
        parts.add('');
        parts.add('Closest candidates: ' + String.join(labels, '; '));
      }
      parts.add('');
      parts.add('Resolution log: ' + log.Name);
      parts.add('');
      parts.add('What the technician said, verbatim:');
      parts.add(log.Resolution_Recap__c);
    }

    parts.add('');
    parts.add(
      'Next step: confirm the root cause, then re-run Tag Root Cause so the Related Case Sweep can work from it.'
    );
    return Codify_Util.clip(String.join(parts, '\n'), 32000);
  }
}
