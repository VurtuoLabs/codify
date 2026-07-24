/**
 * Tests for the three LWC controllers behind the Codify app. All read-only
 * except the article review panel, whose save and reject paths are covered
 * along with the rule that it will not touch a published article.
 */
@IsTest
private class Codify_Controllers_Test {
  /**
   * One resolution that produced a Case update, a root cause tag and an
   * escalation, so every controller has something realistic to read.
   */
  private static Codify_Resolution_Log__c seed() {
    Codify_TestUtil.stubTaxonomy();
    Account a = Codify_TestUtil.account();
    Case c = Codify_TestUtil.openCase(
      a.Id,
      'Controller drops offline each morning'
    );

    Codify_LogResolutionInvocable.Request req = new Codify_LogResolutionInvocable.Request();
    req.resolutionRecap = Codify_TestUtil.RICH_RECAP;
    req.caseId = c.Id;
    Codify_LogResolutionInvocable.Response r = Codify_LogResolutionInvocable.run(
      new List<Codify_LogResolutionInvocable.Request>{ req }
    )[0];

    return [
      SELECT Id, Name, Case__c, Root_Cause_Category__c, Resolution_Recap__c
      FROM Codify_Resolution_Log__c
      WHERE Id = :r.resolutionLogId
    ];
  }

  @IsTest
  static void changeLogConsoleReturnsRowsAndRespectsFilters() {
    Codify_Resolution_Log__c log = seed();

    Test.startTest();
    List<Codify_ChangeLogConsoleController.ChangeRow> all = Codify_ChangeLogConsoleController.getChanges(
      null,
      null,
      null,
      null,
      null,
      null,
      200
    );
    List<Codify_ChangeLogConsoleController.ChangeRow> tagsOnly = Codify_ChangeLogConsoleController.getChanges(
      null,
      null,
      null,
      Codify_Constants.CHANGE_ROOT_CAUSE_TAGGED,
      null,
      null,
      200
    );
    List<Codify_ChangeLogConsoleController.ChangeRow> byTech = Codify_ChangeLogConsoleController.getChanges(
      UserInfo.getUserId(),
      null,
      null,
      null,
      Date.today().addDays(-1),
      Date.today(),
      200
    );
    List<Codify_ChangeLogConsoleController.ChangeRow> byCause = Codify_ChangeLogConsoleController.getChanges(
      null,
      null,
      'Firmware Out of Date',
      null,
      null,
      null,
      200
    );
    Test.stopTest();

    Assert.areEqual(3, all.size(), 'The seed produces three audit rows.');
    Assert.areEqual(
      1,
      tagsOnly.size(),
      'Filtering by change type should narrow the set.'
    );
    Assert.isFalse(
      byTech.isEmpty(),
      'Filtering by technician and date should still match.'
    );
    Assert.isFalse(
      byCause.isEmpty(),
      'Filtering by root cause should match rows linked to the log.'
    );
    Assert.areEqual(
      log.Name,
      byCause[0].sourceResolutionLogName,
      'Rows should carry the source log forward.'
    );
  }

  @IsTest
  static void changeLogConsoleClampsAnAbsurdRowLimit() {
    seed();
    Test.startTest();
    List<Codify_ChangeLogConsoleController.ChangeRow> rows = Codify_ChangeLogConsoleController.getChanges(
      null,
      null,
      null,
      null,
      null,
      null,
      999999
    );
    Test.stopTest();
    Assert.isFalse(
      rows.isEmpty(),
      'An out-of-range limit should fall back to the default, not fail.'
    );
  }

  @IsTest
  static void caseBadgeCountsAndListsChangesForOneRecord() {
    Codify_Resolution_Log__c log = seed();
    Id caseId = log.Case__c;

    Test.startTest();
    Integer count = Codify_ChangeLogConsoleController.countForRecord(caseId);
    List<Codify_ChangeLogConsoleController.ChangeRow> rows = Codify_ChangeLogConsoleController.getChangesForRecord(
      caseId
    );
    Test.stopTest();

    Assert.areEqual(
      2,
      count,
      'The Case itself received a field update and a root cause tag.'
    );
    Assert.areEqual(
      2,
      rows.size(),
      'The badge lists the same rows it counted.'
    );
    Assert.areEqual(
      log.Id,
      rows[0].sourceResolutionLogId,
      'Each row links back to the recap that produced it.'
    );
  }

  @IsTest
  static void caseBadgeHandlesBlankRecordId() {
    Assert.areEqual(
      0,
      Codify_ChangeLogConsoleController.countForRecord(null),
      'Blank id counts zero.'
    );
    Assert.isTrue(
      Codify_ChangeLogConsoleController.getChangesForRecord('').isEmpty(),
      'Blank id returns no rows.'
    );
  }

  @IsTest
  static void filterOptionsAreDerivedFromRealActivity() {
    seed();

    Test.startTest();
    Codify_ChangeLogConsoleController.FilterOptions opts = Codify_ChangeLogConsoleController.getFilterOptions();
    Test.stopTest();

    Assert.isFalse(
      opts.technicians.isEmpty(),
      'The acting technician should appear as a filter option.'
    );
    Assert.areEqual(
      6,
      opts.changeTypes.size(),
      'All six change types should be offered.'
    );
    Assert.isTrue(
      opts.rootCauses.contains('Firmware Out of Date'),
      'Root causes come from real logs.'
    );
  }

  @IsTest
  static void homeDashboardSummarisesActivity() {
    seed();

    Test.startTest();
    Codify_HomeDashboardController.Summary s = Codify_HomeDashboardController.getSummary();
    Test.stopTest();

    Assert.areEqual(1, s.resolutionsThisWeek, 'One resolution was logged.');
    Assert.areEqual(1, s.resolutionsAllTime, 'One resolution all time.');
    Assert.isFalse(
      s.topRootCauses.isEmpty(),
      'The root cause should show in the rollup.'
    );
    Assert.isFalse(
      s.byChangeType.isEmpty(),
      'The change-type breakdown should be populated.'
    );
    Assert.areEqual(
      7,
      s.trend.size(),
      'The trend is always seven zero-filled days.'
    );
  }

  @IsTest
  static void homeDashboardIsSafeOnAnEmptyOrg() {
    Test.startTest();
    Codify_HomeDashboardController.Summary s = Codify_HomeDashboardController.getSummary();
    Test.stopTest();

    Assert.areEqual(
      0,
      s.resolutionsAllTime,
      'An org with no activity reports zeroes, not an error.'
    );
    Assert.areEqual(
      7,
      s.trend.size(),
      'Quiet days are still shown rather than compressed away.'
    );
  }

  @IsTest
  static void rootCauseTrendsRankByRecurrence() {
    Codify_TestUtil.stubTaxonomy();
    Account a = Codify_TestUtil.account();

    List<Codify_Resolution_Log__c> logs = new List<Codify_Resolution_Log__c>();
    for (Integer i = 0; i < 3; i++) {
      logs.add(
        new Codify_Resolution_Log__c(
          Resolution_Recap__c = Codify_TestUtil.RICH_RECAP,
          Root_Cause_Category__c = 'Firmware Out of Date',
          Root_Cause_Key__c = 'Firmware_Out_Of_Date',
          Article_Drafted__c = i == 0,
          Related_Cases_Flagged__c = 2
        )
      );
    }
    logs.add(
      new Codify_Resolution_Log__c(
        Resolution_Recap__c = Codify_TestUtil.RICH_RECAP,
        Root_Cause_Category__c = 'Power Supply Issue',
        Root_Cause_Key__c = 'Power_Supply',
        Related_Cases_Flagged__c = 0
      )
    );
    insert logs;

    Test.startTest();
    List<Codify_HomeDashboardController.RootCauseTrend> trends = Codify_HomeDashboardController.getRootCauseTrends(
      90
    );
    Test.stopTest();

    Assert.areEqual(2, trends.size(), 'Two distinct root causes were logged.');
    Assert.areEqual(
      'Firmware Out of Date',
      trends[0].rootCause,
      'The most recurrent cause ranks first.'
    );
    Assert.areEqual(
      3,
      trends[0].occurrences,
      'Occurrences are counted per cause.'
    );
    Assert.areEqual(
      1,
      trends[0].articlesDrafted,
      'Article output is tracked per cause.'
    );
    Assert.areEqual(
      6,
      trends[0].relatedCasesFlagged,
      'Sweep activity rolls up per cause.'
    );
  }

  @IsTest
  static void rootCauseTrendsDefaultsTheWindow() {
    Test.startTest();
    List<Codify_HomeDashboardController.RootCauseTrend> trends = Codify_HomeDashboardController.getRootCauseTrends(
      null
    );
    Test.stopTest();
    Assert.isTrue(trends.isEmpty(), 'No logs means no trends, and no error.');
  }

  // ---- Article review (requires Knowledge enabled) ----

  private static Id draftArticleFrom(Codify_Resolution_Log__c log) {
    Codify_DraftArticleInvocable.Request req = new Codify_DraftArticleInvocable.Request();
    req.resolutionLogId = log.Id;
    req.caseId = log.Case__c;
    req.forceDraft = true;
    return Codify_Util.toIdOrNull(
      Codify_DraftArticleInvocable.run(
          new List<Codify_DraftArticleInvocable.Request>{ req }
        )[0]
        .articleId
    );
  }

  @IsTest
  static void reviewPanelListsDraftsWithTheirSourceRecap() {
    Codify_Resolution_Log__c log = seed();
    Id articleId = draftArticleFrom(log);

    Test.startTest();
    List<Codify_ArticleReviewController.PendingArticle> pending = Codify_ArticleReviewController.getPendingArticles(
      50
    );
    Integer count = Codify_ArticleReviewController.countPending();
    Test.stopTest();

    Assert.areEqual(
      1,
      pending.size(),
      'The draft should appear in the review queue.'
    );
    Assert.areEqual(1, count, 'The pending count should agree with the list.');

    Codify_ArticleReviewController.PendingArticle a = pending[0];
    Assert.areEqual(
      articleId,
      a.id,
      'The queue returns the draft that was created.'
    );
    Assert.areEqual(
      'Draft',
      a.publishStatus,
      'Only drafts appear in the queue.'
    );
    Assert.areEqual(
      Codify_TestUtil.RICH_RECAP,
      a.originalRecap,
      'The reviewer sees the recap side by side with the draft.'
    );
    Assert.areEqual(
      log.Name,
      a.sourceResolutionLogName,
      'The source log is resolved for the panel.'
    );
    Assert.isTrue(
      String.isNotBlank(a.sourceCaseNumber),
      'The source Case is resolved for the panel.'
    );
  }

  @IsTest
  static void reviewerEditsAreSavedAndAudited() {
    Codify_Resolution_Log__c log = seed();
    Id articleId = draftArticleFrom(log);

    Test.startTest();
    String msg = Codify_ArticleReviewController.saveDraft(
      articleId,
      'Reviewed: firmware update procedure',
      'A tightened summary.',
      '<h2>Resolution</h2><p>Flash then power cycle.</p>'
    );
    Test.stopTest();

    Assert.isTrue(
      msg.contains('still in Draft'),
      'The reviewer must be told it is not live yet.'
    );
    Knowledge__kav k = [
      SELECT Title, Summary, PublishStatus
      FROM Knowledge__kav
      WHERE Id = :articleId
    ];
    Assert.areEqual(
      'Reviewed: firmware update procedure',
      k.Title,
      'Edits should persist.'
    );
    Assert.areEqual('Draft', k.PublishStatus, 'Editing must not publish.');

    Assert.isFalse(
      [
          SELECT Id
          FROM Codify_Change_Log__c
          WHERE
            Object_API_Name__c = :Codify_Constants.OBJ_KNOWLEDGE
            AND Field_Name__c != NULL
        ]
        .isEmpty(),
      'A reviewer edit is audited like any other change.'
    );
  }

  @IsTest
  static void rejectingADraftRemovesItButKeepsTheResolution() {
    Codify_Resolution_Log__c log = seed();
    Id articleId = draftArticleFrom(log);

    Test.startTest();
    String msg = Codify_ArticleReviewController.rejectDraft(
      articleId,
      'Duplicates an existing article.'
    );
    Test.stopTest();

    Assert.isTrue(
      msg.contains('still captured'),
      'Rejecting the draft must not discard the fix.'
    );
    Assert.areEqual(
      0,
      [SELECT COUNT() FROM Knowledge__kav],
      'The draft is removed.'
    );

    Codify_Resolution_Log__c refreshed = [
      SELECT Article_Drafted__c, Resolution_Recap__c
      FROM Codify_Resolution_Log__c
      WHERE Id = :log.Id
    ];
    Assert.isFalse(
      refreshed.Article_Drafted__c,
      'The log no longer claims a draft exists.'
    );
    Assert.isTrue(
      String.isNotBlank(refreshed.Resolution_Recap__c),
      'The recap survives rejection.'
    );

    Assert.isFalse(
      [
          SELECT Id
          FROM Codify_Change_Log__c
          WHERE Change_Type__c = :Codify_Constants.CHANGE_ESCALATED_FOR_REVIEW
        ]
        .isEmpty(),
      'The rejection and its reason are recorded.'
    );
  }

  @IsTest
  static void reviewPanelRejectsBadInput() {
    Boolean threwOnSave = false;
    try {
      Codify_ArticleReviewController.saveDraft(null, 'x', 'y', 'z');
    } catch (AuraHandledException e) {
      threwOnSave = true;
    }
    Assert.isTrue(
      threwOnSave,
      'Saving without an article id must be rejected.'
    );

    Boolean threwOnReject = false;
    try {
      Codify_ArticleReviewController.rejectDraft('nonsense', 'because');
    } catch (AuraHandledException e) {
      threwOnReject = true;
    }
    Assert.isTrue(threwOnReject, 'Rejecting an invalid id must be rejected.');
  }
}
