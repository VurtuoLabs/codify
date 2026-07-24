/**
 * The audit backbone. Every write Codify makes, no exceptions, funnels through
 * here so a Codify_Change_Log__c row exists for it. This is deliberately not
 * optional and not configurable: the point of the audit layer is that nothing
 * Codify does is invisible to service ops.
 *
 * Methods build the rows; callers hand them to insertLogs() so a topic's write
 * and its audit row commit together and stay bulk-safe.
 */
public with sharing class Codify_ChangeLogService {
  public static Codify_Change_Log__c buildResolutionLogged(
    Codify_Resolution_Log__c log,
    Id technicianId
  ) {
    return base(
      Codify_Constants.CHANGE_RESOLUTION_LOGGED,
      log.Id,
      log.Name,
      Codify_Constants.OBJ_RESOLUTION_LOG,
      log.Id,
      technicianId,
      false
    );
  }

  public static Codify_Change_Log__c buildCaseFieldUpdate(
    Id caseId,
    String caseName,
    String fieldName,
    String oldValue,
    String newValue,
    Id resolutionLogId,
    Id technicianId
  ) {
    // Case resolution fields are internal record-keeping, not customer-facing,
    // so they apply directly and are audited without a review flag.
    Codify_Change_Log__c c = base(
      Codify_Constants.CHANGE_CASE_FIELD_UPDATE,
      caseId,
      caseName,
      Codify_Constants.OBJ_CASE,
      resolutionLogId,
      technicianId,
      false
    );
    c.Field_Name__c = fieldName;
    c.Old_Value__c = Codify_Util.clip(oldValue, 32000);
    c.New_Value__c = Codify_Util.clip(newValue, 32000);
    return c;
  }

  public static Codify_Change_Log__c buildRootCauseTagged(
    Id caseId,
    String caseName,
    String oldValue,
    String newValue,
    Id resolutionLogId,
    Id technicianId
  ) {
    Codify_Change_Log__c c = base(
      Codify_Constants.CHANGE_ROOT_CAUSE_TAGGED,
      caseId,
      caseName,
      Codify_Constants.OBJ_CASE,
      resolutionLogId,
      technicianId,
      false
    );
    c.Field_Name__c = 'Codify_Root_Cause__c';
    c.Old_Value__c = Codify_Util.clip(oldValue, 32000);
    c.New_Value__c = Codify_Util.clip(newValue, 32000);
    return c;
  }

  /**
   * Knowledge drafts always land flagged for human review. A wrong or misleading
   * self-service article reaching customers is a real risk, so this row exists
   * specifically to make the pending draft visible to a Knowledge owner.
   */
  public static Codify_Change_Log__c buildArticleDrafted(
    Id articleId,
    String title,
    Id resolutionLogId,
    Id technicianId
  ) {
    return base(
      Codify_Constants.CHANGE_ARTICLE_DRAFTED,
      articleId,
      title,
      Codify_Constants.OBJ_KNOWLEDGE,
      resolutionLogId,
      technicianId,
      true
    );
  }

  public static Codify_Change_Log__c buildRelatedCaseFlagged(
    Id caseId,
    String caseName,
    String suggestedFix,
    Id resolutionLogId,
    Id technicianId
  ) {
    Codify_Change_Log__c c = base(
      Codify_Constants.CHANGE_RELATED_CASE_FLAGGED,
      caseId,
      caseName,
      Codify_Constants.OBJ_CASE,
      resolutionLogId,
      technicianId,
      false
    );
    c.Field_Name__c = 'Codify_Suggested_Fix__c';
    c.New_Value__c = Codify_Util.clip(suggestedFix, 32000);
    return c;
  }

  /**
   * Raised when a recap is too thin to classify. This is a successful outcome,
   * not an error: routing to a human beats forcing a low-confidence tag that
   * would misdirect the Related Case Sweep onto unrelated Cases.
   */
  public static Codify_Change_Log__c buildEscalated(
    Id taskId,
    String subject,
    String reason,
    Id resolutionLogId,
    Id technicianId
  ) {
    Codify_Change_Log__c c = base(
      Codify_Constants.CHANGE_ESCALATED_FOR_REVIEW,
      taskId,
      subject,
      Codify_Constants.OBJ_TASK,
      resolutionLogId,
      technicianId,
      true
    );
    c.New_Value__c = Codify_Util.clip(reason, 32000);
    return c;
  }

  /**
   * Persist the audit rows. Uses allOrNone=false so a single bad row never
   * suppresses the rest of the audit trail; failures are logged, not swallowed.
   */
  public static void insertLogs(List<Codify_Change_Log__c> logs) {
    if (logs == null || logs.isEmpty()) {
      return;
    }
    List<Database.SaveResult> results = Database.insert(logs, false);
    for (Database.SaveResult sr : results) {
      if (!sr.isSuccess()) {
        for (Database.Error e : sr.getErrors()) {
          System.debug(
            LoggingLevel.ERROR,
            'Codify change-log insert failed: ' + e.getMessage()
          );
        }
      }
    }
  }

  private static Codify_Change_Log__c base(
    String changeType,
    Id recordId,
    String recordName,
    String objectApiName,
    Id resolutionLogId,
    Id technicianId,
    Boolean requiresReview
  ) {
    return new Codify_Change_Log__c(
      Change_Type__c = changeType,
      Related_Record_Id__c = recordId,
      Related_Record_Name__c = Codify_Util.clip(recordName, 255),
      Object_API_Name__c = objectApiName,
      Source_Resolution_Log__c = resolutionLogId,
      Created_By_Technician__c = technicianId,
      Requires_Human_Review__c = requiresReview == true
    );
  }
}
