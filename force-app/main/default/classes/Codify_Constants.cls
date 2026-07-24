/**
 * Central constants for Codify. Keeping change-type and object names in one place
 * means the audit layer and every invocable speak exactly the same vocabulary.
 */
public with sharing class Codify_Constants {
  // Change_Type__c picklist values (must match Codify_Change_Log__c metadata).
  public static final String CHANGE_RESOLUTION_LOGGED = 'Resolution Logged';
  public static final String CHANGE_CASE_FIELD_UPDATE = 'Case Field Update';
  public static final String CHANGE_ROOT_CAUSE_TAGGED = 'Root Cause Tagged';
  public static final String CHANGE_ARTICLE_DRAFTED = 'Article Drafted';
  public static final String CHANGE_RELATED_CASE_FLAGGED = 'Related Case Flagged';
  public static final String CHANGE_ESCALATED_FOR_REVIEW = 'Escalated for Review';

  // Object API names, used on change-log rows.
  public static final String OBJ_CASE = 'Case';
  public static final String OBJ_KNOWLEDGE = 'Knowledge__kav';
  public static final String OBJ_TASK = 'Task';
  public static final String OBJ_RESOLUTION_LOG = 'Codify_Resolution_Log__c';

  /**
   * Below this classifier score Codify refuses to tag a root cause and escalates
   * instead. Deliberately not configurable per-recap: a wrong root cause tag
   * misdirects the Related Case Sweep and suggests the wrong fix on other Cases,
   * so the floor is a property of the system, not of the conversation.
   */
  public static final Decimal ROOT_CAUSE_CONFIDENCE_FLOOR = 0.34;

  /** A recap shorter than this cannot carry enough signal to classify. */
  public static final Integer MIN_RECAP_LENGTH = 25;

  /** How many other open Cases a single sweep will flag, to keep one fix from spamming a backlog. */
  public static final Integer MAX_SWEEP_CASES = 25;

  /** Days out the escalation Task is due when a recap is too thin to classify. */
  public static final Integer ESCALATION_DUE_DAYS = 2;

  /** Knowledge drafts are created in this state and never any other. Hard rule. */
  public static final String KNOWLEDGE_DRAFT_STATUS = 'Draft';
}
