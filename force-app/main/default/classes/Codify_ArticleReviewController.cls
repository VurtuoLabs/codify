/**
 * Controller for codifyArticleReviewPanel. Lets a Knowledge owner review a
 * drafted article side by side with the recap it came from, rather than opening
 * the standard Knowledge editor cold with no idea what the draft is based on.
 *
 * Publishing is deliberately NOT implemented here. Codify's rule is that drafts
 * go live through Salesforce's native Knowledge publishing process, operated by
 * a human, and adding a "publish" button to Codify's own surface would quietly
 * turn a hard guardrail into a one-click bypass. This controller can edit a
 * draft's content and it can reject one; making it live stays outside Codify.
 */
public with sharing class Codify_ArticleReviewController {
  public class PendingArticle {
    @AuraEnabled
    public Id id;
    @AuraEnabled
    public String title;
    @AuraEnabled
    public String summary;
    @AuraEnabled
    public String body;
    @AuraEnabled
    public String rootCause;
    @AuraEnabled
    public String originalRecap;
    @AuraEnabled
    public String sourceCaseId;
    @AuraEnabled
    public String sourceCaseNumber;
    @AuraEnabled
    public String sourceResolutionLogId;
    @AuraEnabled
    public String sourceResolutionLogName;
    @AuraEnabled
    public String technicianName;
    @AuraEnabled
    public String publishStatus;
    @AuraEnabled
    public Datetime lastModified;
  }

  /**
   * The review queue: Codify-authored drafts nobody has actioned yet.
   * Returns an empty list rather than throwing when Knowledge is not enabled,
   * so the tab degrades to "nothing to review" instead of an error page.
   */
  @AuraEnabled(cacheable=true)
  public static List<PendingArticle> getPendingArticles(Integer maxRows) {
    Integer lim = (maxRows == null ||
      maxRows <= 0 ||
      maxRows > 500)
      ? 100
      : maxRows;
    List<PendingArticle> out = new List<PendingArticle>();

    List<Knowledge__kav> drafts;
    try {
      drafts = [
        SELECT
          Id,
          Title,
          Summary,
          Codify_Article_Body__c,
          Codify_Root_Cause__c,
          Codify_Original_Recap__c,
          Codify_Source_Case__c,
          Codify_Source_Resolution_Log__c,
          PublishStatus,
          LastModifiedDate
        FROM Knowledge__kav
        WHERE
          Codify_Generated__c = TRUE
          AND PublishStatus = :Codify_Constants.KNOWLEDGE_DRAFT_STATUS
        ORDER BY LastModifiedDate DESC
        LIMIT :lim
      ];
    } catch (Exception e) {
      System.debug(
        LoggingLevel.WARN,
        'Codify: Knowledge unavailable: ' + e.getMessage()
      );
      return out;
    }

    // Resolve the linked Case and resolution log in bulk rather than per row.
    Set<Id> caseIds = new Set<Id>();
    Set<Id> logIds = new Set<Id>();
    for (Knowledge__kav k : drafts) {
      Id cId = Codify_Util.toIdOrNull(k.Codify_Source_Case__c);
      if (cId != null) {
        caseIds.add(cId);
      }
      Id lId = Codify_Util.toIdOrNull(k.Codify_Source_Resolution_Log__c);
      if (lId != null) {
        logIds.add(lId);
      }
    }

    Map<Id, Case> cases = caseIds.isEmpty()
      ? new Map<Id, Case>()
      : new Map<Id, Case>(
          [SELECT Id, CaseNumber FROM Case WHERE Id IN :caseIds]
        );
    Map<Id, Codify_Resolution_Log__c> logs = logIds.isEmpty()
      ? new Map<Id, Codify_Resolution_Log__c>()
      : new Map<Id, Codify_Resolution_Log__c>(
          [
            SELECT Id, Name, Logged_By_Technician__r.Name
            FROM Codify_Resolution_Log__c
            WHERE Id IN :logIds
          ]
        );

    for (Knowledge__kav k : drafts) {
      PendingArticle a = new PendingArticle();
      a.id = k.Id;
      a.title = k.Title;
      a.summary = k.Summary;
      a.body = k.Codify_Article_Body__c;
      a.rootCause = k.Codify_Root_Cause__c;
      a.originalRecap = k.Codify_Original_Recap__c;
      a.publishStatus = k.PublishStatus;
      a.lastModified = k.LastModifiedDate;

      Id cId = Codify_Util.toIdOrNull(k.Codify_Source_Case__c);
      if (cId != null && cases.containsKey(cId)) {
        a.sourceCaseId = cId;
        a.sourceCaseNumber = cases.get(cId).CaseNumber;
      }
      Id lId = Codify_Util.toIdOrNull(k.Codify_Source_Resolution_Log__c);
      if (lId != null && logs.containsKey(lId)) {
        a.sourceResolutionLogId = lId;
        a.sourceResolutionLogName = logs.get(lId).Name;
        a.technicianName = logs.get(lId).Logged_By_Technician__r.Name;
      }
      out.add(a);
    }
    return out;
  }

  @AuraEnabled(cacheable=true)
  public static Integer countPending() {
    try {
      return [
        SELECT COUNT()
        FROM Knowledge__kav
        WHERE
          Codify_Generated__c = TRUE
          AND PublishStatus = :Codify_Constants.KNOWLEDGE_DRAFT_STATUS
      ];
    } catch (Exception e) {
      System.debug(
        LoggingLevel.WARN,
        'Codify: Knowledge unavailable: ' + e.getMessage()
      );
      return 0;
    }
  }

  /**
   * Save a reviewer's edits back to the draft. The article stays in Draft, and
   * the edit is audited so "what did the human change versus what Codify
   * wrote" is answerable later.
   */
  @AuraEnabled
  public static String saveDraft(
    String articleId,
    String title,
    String summary,
    String body
  ) {
    Id aId = Codify_Util.toIdOrNull(articleId);
    if (aId == null) {
      throw new AuraHandledException('No article was selected.');
    }

    List<Knowledge__kav> existing = [
      SELECT
        Id,
        Title,
        Summary,
        Codify_Article_Body__c,
        PublishStatus,
        Codify_Source_Resolution_Log__c
      FROM Knowledge__kav
      WHERE Id = :aId
      LIMIT 1
    ];
    if (existing.isEmpty()) {
      throw new AuraHandledException('That article could not be found.');
    }

    Knowledge__kav k = existing[0];
    if (k.PublishStatus != Codify_Constants.KNOWLEDGE_DRAFT_STATUS) {
      // Editing a published article is a Knowledge workflow, not a Codify one.
      throw new AuraHandledException(
        'Only drafts can be edited here. Use the Knowledge editor for published articles.'
      );
    }

    String oldTitle = k.Title;
    k.Title = Codify_Util.clip(title, 255);
    k.Summary = Codify_Util.clip(summary, 1000);
    k.Codify_Article_Body__c = Codify_Util.clip(body, 32000);
    update k;

    Codify_Change_Log__c audit = Codify_ChangeLogService.buildCaseFieldUpdate(
      k.Id,
      k.Title,
      'Knowledge draft edited by reviewer',
      oldTitle,
      k.Title,
      Codify_Util.toIdOrNull(k.Codify_Source_Resolution_Log__c),
      UserInfo.getUserId()
    );
    audit.Object_API_Name__c = Codify_Constants.OBJ_KNOWLEDGE;
    audit.Requires_Human_Review__c = false;
    Codify_ChangeLogService.insertLogs(new List<Codify_Change_Log__c>{ audit });

    return 'Saved. The article is still in Draft, publish it through Knowledge when you are happy with it.';
  }

  /**
   * Reject a draft the reviewer does not want. Deletes the draft (it was never
   * live) and records why, so a technician whose recap keeps producing rejected
   * drafts is a visible pattern rather than a mystery.
   */
  @AuraEnabled
  public static String rejectDraft(String articleId, String reason) {
    Id aId = Codify_Util.toIdOrNull(articleId);
    if (aId == null) {
      throw new AuraHandledException('No article was selected.');
    }

    List<Knowledge__kav> existing = [
      SELECT
        Id,
        Title,
        PublishStatus,
        KnowledgeArticleId,
        Codify_Source_Resolution_Log__c
      FROM Knowledge__kav
      WHERE Id = :aId
      LIMIT 1
    ];
    if (existing.isEmpty()) {
      throw new AuraHandledException('That article could not be found.');
    }
    Knowledge__kav k = existing[0];
    if (k.PublishStatus != Codify_Constants.KNOWLEDGE_DRAFT_STATUS) {
      throw new AuraHandledException('Only drafts can be rejected here.');
    }

    Id logId = Codify_Util.toIdOrNull(k.Codify_Source_Resolution_Log__c);
    String title = k.Title;

    Codify_Change_Log__c audit = Codify_ChangeLogService.buildEscalated(
      k.Id,
      'Knowledge draft rejected: ' + title,
      String.isBlank(reason)
        ? 'Rejected by reviewer without a stated reason.'
        : reason,
      logId,
      UserInfo.getUserId()
    );
    audit.Object_API_Name__c = Codify_Constants.OBJ_KNOWLEDGE;

    // Knowledge articles are not deletable with plain DML; they have to go
    // through the publishing service, keyed on the parent article id rather
    // than this version's id.
    KbManagement.PublishingService.deleteDraftArticle(k.KnowledgeArticleId);

    if (logId != null) {
      update new Codify_Resolution_Log__c(
        Id = logId,
        Article_Drafted__c = false,
        Knowledge_Article_Id__c = null
      );
    }
    Codify_ChangeLogService.insertLogs(new List<Codify_Change_Log__c>{ audit });

    return 'Draft rejected and removed. The resolution log is unchanged, so the fix is still captured.';
  }
}
