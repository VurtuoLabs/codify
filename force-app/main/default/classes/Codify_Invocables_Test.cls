/**
 * Tests for the five invocable actions behind the agent's topics.
 *
 * The guardrails get the most attention, because they are what make Codify safe
 * to point at a real knowledge base: every write produces an audit row, Knowledge
 * drafts never publish, and the Related Case Sweep refuses to run from an
 * uncertain diagnosis.
 *
 * The Knowledge-backed tests need Knowledge enabled in the target org and the
 * running user flagged as a Knowledge User; see the README for setup.
 */
@IsTest
private class Codify_Invocables_Test {
  // ---- Topic 1: Log Resolution ----

  @IsTest
  static void logResolutionWritesCaseFieldsTagsAndAudits() {
    Codify_TestUtil.stubTaxonomy();
    Account a = Codify_TestUtil.account();
    Case c = Codify_TestUtil.openCase(
      a.Id,
      'Controller drops offline each morning'
    );

    Codify_LogResolutionInvocable.Request req = new Codify_LogResolutionInvocable.Request();
    req.resolutionRecap = Codify_TestUtil.RICH_RECAP;
    req.caseId = c.Id;

    Test.startTest();
    List<Codify_LogResolutionInvocable.Response> out = Codify_LogResolutionInvocable.run(
      new List<Codify_LogResolutionInvocable.Request>{ req }
    );
    Test.stopTest();

    Codify_LogResolutionInvocable.Response r = out[0];
    Assert.isTrue(r.success, 'Logging should succeed.');
    Assert.isTrue(
      r.rootCauseTagged,
      'A confident recap should tag in the same pass.'
    );
    Assert.areEqual(
      'Firmware_Out_Of_Date',
      r.rootCauseKey,
      'Should tag the corroborated cause.'
    );

    Case updated = [
      SELECT
        Codify_Resolution_Summary__c,
        Codify_Root_Cause__c,
        Codify_Root_Cause_Key__c,
        Codify_Resolved_Via_Codify__c
      FROM Case
      WHERE Id = :c.Id
    ];
    Assert.isTrue(
      String.isNotBlank(updated.Codify_Resolution_Summary__c),
      'The resolution should land on the Case.'
    );
    Assert.areEqual(
      'Firmware Out of Date',
      updated.Codify_Root_Cause__c,
      'The Case should carry the label.'
    );
    Assert.isTrue(
      updated.Codify_Resolved_Via_Codify__c,
      'The Case should be marked as resolved via Codify.'
    );

    // Every write, no exceptions, produces an audit row.
    List<Codify_Change_Log__c> audit = [
      SELECT Change_Type__c, Old_Value__c, New_Value__c
      FROM Codify_Change_Log__c
      ORDER BY Change_Type__c
    ];
    Assert.areEqual(
      3,
      audit.size(),
      'Expect resolution logged, field update, and root cause tagged.'
    );
    Set<String> types = new Set<String>();
    for (Codify_Change_Log__c row : audit) {
      types.add(row.Change_Type__c);
    }
    Assert.isTrue(
      types.contains(Codify_Constants.CHANGE_RESOLUTION_LOGGED),
      'Resolution logged must be audited.'
    );
    Assert.isTrue(
      types.contains(Codify_Constants.CHANGE_CASE_FIELD_UPDATE),
      'Field update must be audited.'
    );
    Assert.isTrue(
      types.contains(Codify_Constants.CHANGE_ROOT_CAUSE_TAGGED),
      'Root cause tag must be audited.'
    );
  }

  @IsTest
  static void logResolutionKeepsThinRecapButRefusesToTag() {
    Codify_TestUtil.stubTaxonomy();
    Account a = Codify_TestUtil.account();
    Case c = Codify_TestUtil.openCase(a.Id, 'Something intermittent');

    Codify_LogResolutionInvocable.Request req = new Codify_LogResolutionInvocable.Request();
    req.resolutionRecap = Codify_TestUtil.AMBIGUOUS_RECAP;
    req.caseId = c.Id;

    Test.startTest();
    Codify_LogResolutionInvocable.Response r = Codify_LogResolutionInvocable.run(
      new List<Codify_LogResolutionInvocable.Request>{ req }
    )[0];
    Test.stopTest();

    Assert.isTrue(r.lowConfidence, 'An ambiguous recap must be flagged.');
    Assert.isFalse(r.rootCauseTagged, 'Codify must not guess a root cause.');
    Assert.isTrue(
      String.isNotBlank(r.clarifyingQuestion),
      'It should ask something specific instead of guessing.'
    );

    Case updated = [SELECT Codify_Root_Cause__c FROM Case WHERE Id = :c.Id];
    Assert.isNull(
      updated.Codify_Root_Cause__c,
      'No tag should be written when confidence is low.'
    );

    // The recap itself is still captured; losing it would defeat the audit trail.
    Assert.areEqual(
      1,
      [SELECT COUNT() FROM Codify_Resolution_Log__c],
      'The raw recap must still be stored.'
    );
  }

  @IsTest
  static void logResolutionWorksWithoutACase() {
    Codify_TestUtil.stubTaxonomy();
    Codify_LogResolutionInvocable.Request req = new Codify_LogResolutionInvocable.Request();
    req.resolutionRecap = Codify_TestUtil.RICH_RECAP;
    req.sourceChannel = 'Dictation';

    Test.startTest();
    Codify_LogResolutionInvocable.Response r = Codify_LogResolutionInvocable.run(
      new List<Codify_LogResolutionInvocable.Request>{ req }
    )[0];
    Test.stopTest();

    Assert.isTrue(
      r.success,
      'A recap with no Case id should still be captured.'
    );
    Codify_Resolution_Log__c log = [
      SELECT Source_Channel__c, Case__c
      FROM Codify_Resolution_Log__c
      LIMIT 1
    ];
    Assert.areEqual(
      'Dictation',
      log.Source_Channel__c,
      'The channel should be recorded.'
    );
    Assert.isNull(log.Case__c, 'No Case is linked when none was supplied.');
  }

  // ---- Topic 2: Tag Root Cause ----

  @IsTest
  static void tagRootCauseHonoursAnExplicitTechnicianOverride() {
    Codify_TestUtil.stubTaxonomy();
    Account a = Codify_TestUtil.account();
    Case c = Codify_TestUtil.openCase(a.Id, 'Site outage');

    Codify_TagRootCauseInvocable.Request req = new Codify_TagRootCauseInvocable.Request();
    req.caseId = c.Id;
    req.rootCauseKey = 'Power_Supply';

    Test.startTest();
    Codify_TagRootCauseInvocable.Response r = Codify_TagRootCauseInvocable.run(
      new List<Codify_TagRootCauseInvocable.Request>{ req }
    )[0];
    Test.stopTest();

    Assert.isTrue(r.tagged, 'A human naming the cause should always win.');
    Assert.areEqual(
      'Power Supply Issue',
      r.rootCauseLabel,
      'The label should come from the taxonomy.'
    );
    Assert.areEqual(
      1,
      r.confidence,
      'A technician-supplied cause is fully confident.'
    );
    Assert.areEqual(
      1,
      [
        SELECT COUNT()
        FROM Codify_Change_Log__c
        WHERE Change_Type__c = :Codify_Constants.CHANGE_ROOT_CAUSE_TAGGED
      ],
      'The tag must be audited.'
    );
  }

  @IsTest
  static void tagRootCauseRejectsAnUnknownKey() {
    Codify_TestUtil.stubTaxonomy();
    Account a = Codify_TestUtil.account();
    Case c = Codify_TestUtil.openCase(a.Id, 'Site outage');

    Codify_TagRootCauseInvocable.Request req = new Codify_TagRootCauseInvocable.Request();
    req.caseId = c.Id;
    req.rootCauseKey = 'Gremlins';

    Test.startTest();
    Codify_TagRootCauseInvocable.Response r = Codify_TagRootCauseInvocable.run(
      new List<Codify_TagRootCauseInvocable.Request>{ req }
    )[0];
    Test.stopTest();

    Assert.isFalse(
      r.tagged,
      'A cause outside the taxonomy must not be invented.'
    );
    Assert.isTrue(
      r.lowConfidence,
      'An unknown key is a low-confidence outcome.'
    );
  }

  @IsTest
  static void tagRootCauseDeclinesOnAmbiguousRecapAndNamesCandidates() {
    Codify_TestUtil.stubTaxonomy();
    Account a = Codify_TestUtil.account();
    Case c = Codify_TestUtil.openCase(a.Id, 'Unclear fault');

    Codify_TagRootCauseInvocable.Request req = new Codify_TagRootCauseInvocable.Request();
    req.caseId = c.Id;
    req.resolutionRecap = Codify_TestUtil.AMBIGUOUS_RECAP;

    Test.startTest();
    Codify_TagRootCauseInvocable.Response r = Codify_TagRootCauseInvocable.run(
      new List<Codify_TagRootCauseInvocable.Request>{ req }
    )[0];
    Test.stopTest();

    Assert.isFalse(r.tagged, 'Ambiguity must not produce a tag.');
    Assert.isTrue(
      r.summary.contains('Do not guess'),
      'The agent should be told explicitly not to guess.'
    );
  }

  @IsTest
  static void tagRootCauseFailsCleanlyWithoutACaseId() {
    Codify_TestUtil.stubTaxonomy();
    Codify_TagRootCauseInvocable.Request req = new Codify_TagRootCauseInvocable.Request();
    req.rootCauseKey = 'Power_Supply';

    Codify_TagRootCauseInvocable.Response r = Codify_TagRootCauseInvocable.run(
      new List<Codify_TagRootCauseInvocable.Request>{ req }
    )[0];

    Assert.isFalse(r.success, 'No Case means nothing to tag.');
    Assert.isFalse(r.tagged, 'Nothing should be written.');
  }

  // ---- Topic 4: Related Case Sweep ----

  @IsTest
  static void sweepFlagsOtherOpenCasesSharingTheRootCause() {
    Codify_TestUtil.stubTaxonomy();
    Account a = Codify_TestUtil.account();
    Case resolved = Codify_TestUtil.openCase(a.Id, 'Controller offline');
    Case sibling = Codify_TestUtil.taggedCase(
      a.Id,
      'Second controller offline',
      'Firmware_Out_Of_Date',
      'Firmware Out of Date'
    );
    Case unrelated = Codify_TestUtil.taggedCase(
      a.Id,
      'Cracked housing',
      'Wear_And_Tear',
      'Normal Wear and Tear'
    );

    Codify_Resolution_Log__c log = new Codify_Resolution_Log__c(
      Case__c = resolved.Id,
      Resolution_Recap__c = Codify_TestUtil.RICH_RECAP,
      Resolution_Summary__c = 'Flashed firmware to 4.2.1 and power cycled.',
      Root_Cause_Key__c = 'Firmware_Out_Of_Date',
      Root_Cause_Category__c = 'Firmware Out of Date',
      Root_Cause_Confidence__c = 0.67,
      Low_Confidence__c = false
    );
    insert log;

    Codify_RelatedCaseSweepInvocable.Request req = new Codify_RelatedCaseSweepInvocable.Request();
    req.resolutionLogId = log.Id;
    req.caseId = resolved.Id;

    Test.startTest();
    Codify_RelatedCaseSweepInvocable.Response r = Codify_RelatedCaseSweepInvocable.run(
      new List<Codify_RelatedCaseSweepInvocable.Request>{ req }
    )[0];
    Test.stopTest();

    Assert.areEqual(
      1,
      r.casesFlagged,
      'Only the matching open Case should be flagged.'
    );

    Case flagged = [
      SELECT Codify_Suggested_Fix__c, Codify_Resolution_Summary__c
      FROM Case
      WHERE Id = :sibling.Id
    ];
    Assert.isTrue(
      String.isNotBlank(flagged.Codify_Suggested_Fix__c),
      'The sibling Case gets a suggestion.'
    );
    Assert.isNull(
      flagged.Codify_Resolution_Summary__c,
      'The sweep must never resolve someone else\'s Case, only suggest.'
    );

    Case untouched = [
      SELECT Codify_Suggested_Fix__c
      FROM Case
      WHERE Id = :unrelated.Id
    ];
    Assert.isNull(
      untouched.Codify_Suggested_Fix__c,
      'An unrelated root cause must not be swept in.'
    );

    Assert.areEqual(
      1,
      [
        SELECT COUNT()
        FROM Codify_Change_Log__c
        WHERE Change_Type__c = :Codify_Constants.CHANGE_RELATED_CASE_FLAGGED
      ],
      'Each flagged Case must be audited.'
    );
  }

  @IsTest
  static void sweepRefusesToRunFromAnUncertainDiagnosis() {
    Codify_TestUtil.stubTaxonomy();
    Account a = Codify_TestUtil.account();
    Case resolved = Codify_TestUtil.openCase(a.Id, 'Unclear fault');
    Case sibling = Codify_TestUtil.taggedCase(
      a.Id,
      'Another one',
      'Firmware_Out_Of_Date',
      'Firmware Out of Date'
    );

    // Low confidence: exactly the state that must not spread a fix.
    Codify_Resolution_Log__c log = new Codify_Resolution_Log__c(
      Case__c = resolved.Id,
      Resolution_Recap__c = Codify_TestUtil.AMBIGUOUS_RECAP,
      Root_Cause_Key__c = 'Firmware_Out_Of_Date',
      Low_Confidence__c = true
    );
    insert log;

    Codify_RelatedCaseSweepInvocable.Request req = new Codify_RelatedCaseSweepInvocable.Request();
    req.resolutionLogId = log.Id;
    req.caseId = resolved.Id;

    Test.startTest();
    Codify_RelatedCaseSweepInvocable.Response r = Codify_RelatedCaseSweepInvocable.run(
      new List<Codify_RelatedCaseSweepInvocable.Request>{ req }
    )[0];
    Test.stopTest();

    Assert.isTrue(r.skipped, 'A low-confidence diagnosis must not be swept.');
    Assert.areEqual(0, r.casesFlagged, 'Nothing should be flagged.');
    Case untouched = [
      SELECT Codify_Suggested_Fix__c
      FROM Case
      WHERE Id = :sibling.Id
    ];
    Assert.isNull(
      untouched.Codify_Suggested_Fix__c,
      'The wrong fix must not reach other Cases.'
    );
  }

  @IsTest
  static void sweepReportsCleanlyWhenNothingMatches() {
    Codify_TestUtil.stubTaxonomy();
    Account a = Codify_TestUtil.account();
    Case resolved = Codify_TestUtil.openCase(a.Id, 'Isolated issue');
    Codify_Resolution_Log__c log = new Codify_Resolution_Log__c(
      Case__c = resolved.Id,
      Resolution_Recap__c = Codify_TestUtil.RICH_RECAP,
      Resolution_Summary__c = 'Flashed firmware.',
      Root_Cause_Key__c = 'Firmware_Out_Of_Date',
      Root_Cause_Category__c = 'Firmware Out of Date',
      Low_Confidence__c = false
    );
    insert log;

    Codify_RelatedCaseSweepInvocable.Request req = new Codify_RelatedCaseSweepInvocable.Request();
    req.resolutionLogId = log.Id;
    req.caseId = resolved.Id;
    req.includeRelated = false;

    Test.startTest();
    Codify_RelatedCaseSweepInvocable.Response r = Codify_RelatedCaseSweepInvocable.run(
      new List<Codify_RelatedCaseSweepInvocable.Request>{ req }
    )[0];
    Test.stopTest();

    Assert.isTrue(r.success, 'Finding nothing is a successful outcome.');
    Assert.areEqual(0, r.casesFlagged, 'Nothing to flag.');
  }

  @IsTest
  static void sweepFailsCleanlyOnBadLogId() {
    Codify_RelatedCaseSweepInvocable.Request req = new Codify_RelatedCaseSweepInvocable.Request();
    req.resolutionLogId = 'nonsense';
    Codify_RelatedCaseSweepInvocable.Response r = Codify_RelatedCaseSweepInvocable.run(
      new List<Codify_RelatedCaseSweepInvocable.Request>{ req }
    )[0];
    Assert.isFalse(r.success, 'An invalid id should fail cleanly, not throw.');
  }

  // ---- Topic 5: Escalate for Review ----

  @IsTest
  static void escalationCreatesAnActionableTaskAndAudits() {
    Codify_TestUtil.stubTaxonomy();
    Account a = Codify_TestUtil.account();
    Case c = Codify_TestUtil.openCase(a.Id, 'Unclear fault');

    Codify_ResolutionParse parse = Codify_ExtractionService.parse(
      Codify_TestUtil.AMBIGUOUS_RECAP
    );
    Codify_Resolution_Log__c log = new Codify_Resolution_Log__c(
      Case__c = c.Id,
      Resolution_Recap__c = Codify_TestUtil.AMBIGUOUS_RECAP,
      Extraction_JSON__c = parse.toJsonString(),
      Low_Confidence__c = true
    );
    insert log;

    Codify_EscalateForReviewInvocable.Request req = new Codify_EscalateForReviewInvocable.Request();
    req.resolutionLogId = log.Id;
    req.caseId = c.Id;
    req.reason = 'Could not tell whether this was network or power.';

    Test.startTest();
    Codify_EscalateForReviewInvocable.Response r = Codify_EscalateForReviewInvocable.run(
      new List<Codify_EscalateForReviewInvocable.Request>{ req }
    )[0];
    Test.stopTest();

    Assert.isTrue(r.success, 'Escalation should succeed.');
    Task t = [
      SELECT Subject, Description, WhatId, ActivityDate
      FROM Task
      WHERE Id = :r.taskId
    ];
    Assert.areEqual(c.Id, t.WhatId, 'The task should hang off the Case.');
    Assert.isTrue(
      t.Description.contains(Codify_TestUtil.AMBIGUOUS_RECAP),
      'The reviewer needs the technician\'s verbatim words.'
    );
    Assert.isTrue(
      t.Description.contains('Could not tell'),
      'The stated reason should be carried through.'
    );

    Assert.areEqual(
      1,
      [
        SELECT COUNT()
        FROM Codify_Change_Log__c
        WHERE Change_Type__c = :Codify_Constants.CHANGE_ESCALATED_FOR_REVIEW
      ],
      'Escalations are audited like every other action.'
    );
  }

  @IsTest
  static void escalationWorksWithNoLogOrCase() {
    Codify_EscalateForReviewInvocable.Request req = new Codify_EscalateForReviewInvocable.Request();
    req.reason = 'Technician disconnected mid-recap.';

    Test.startTest();
    Codify_EscalateForReviewInvocable.Response r = Codify_EscalateForReviewInvocable.run(
      new List<Codify_EscalateForReviewInvocable.Request>{ req }
    )[0];
    Test.stopTest();

    Assert.isTrue(
      r.success,
      'An escalation should never be blocked by missing context.'
    );
    Assert.isNotNull(
      r.taskId,
      'A task is still created so a human picks it up.'
    );
  }

  // ---- Topic 3: Draft Knowledge Article (requires Knowledge enabled) ----

  @IsTest
  static void draftArticleCreatesADraftThatIsNeverPublished() {
    Codify_TestUtil.stubTaxonomy();
    Account a = Codify_TestUtil.account();
    Case c = Codify_TestUtil.openCase(
      a.Id,
      'Controller drops offline each morning'
    );

    Codify_ResolutionParse parse = Codify_ExtractionService.parse(
      Codify_TestUtil.RICH_RECAP
    );
    Codify_Resolution_Log__c log = new Codify_Resolution_Log__c(
      Case__c = c.Id,
      Resolution_Recap__c = Codify_TestUtil.RICH_RECAP,
      Resolution_Summary__c = parse.resolutionSummary,
      Root_Cause_Category__c = 'Firmware Out of Date',
      Root_Cause_Key__c = 'Firmware_Out_Of_Date',
      Extraction_JSON__c = parse.toJsonString()
    );
    insert log;

    Codify_DraftArticleInvocable.Request req = new Codify_DraftArticleInvocable.Request();
    req.resolutionLogId = log.Id;
    req.caseId = c.Id;

    Test.startTest();
    Codify_DraftArticleInvocable.Response r = Codify_DraftArticleInvocable.run(
      new List<Codify_DraftArticleInvocable.Request>{ req }
    )[0];
    Test.stopTest();

    Assert.isTrue(r.drafted, 'A rich recap should produce a draft.');
    Assert.isTrue(r.requiresHumanReview, 'Drafts always require human review.');

    Knowledge__kav article = [
      SELECT
        Title,
        PublishStatus,
        Codify_Generated__c,
        Codify_Original_Recap__c,
        Codify_Article_Body__c
      FROM Knowledge__kav
      WHERE Id = :r.articleId
    ];
    Assert.areEqual(
      'Draft',
      article.PublishStatus,
      'A Codify article must never be created live.'
    );
    Assert.isTrue(
      article.Codify_Generated__c,
      'Drafts are marked so the review queue can find them.'
    );
    Assert.areEqual(
      Codify_TestUtil.RICH_RECAP,
      article.Codify_Original_Recap__c,
      'The verbatim recap travels with the draft for side-by-side review.'
    );
    Assert.isTrue(
      article.Codify_Article_Body__c.contains('Root cause'),
      'The body should be sectioned.'
    );

    Codify_Resolution_Log__c refreshed = [
      SELECT Article_Drafted__c, Knowledge_Article_Id__c
      FROM Codify_Resolution_Log__c
      WHERE Id = :log.Id
    ];
    Assert.isTrue(
      refreshed.Article_Drafted__c,
      'The log records that a draft came out of it.'
    );

    Assert.areEqual(
      1,
      [
        SELECT COUNT()
        FROM Codify_Change_Log__c
        WHERE Change_Type__c = :Codify_Constants.CHANGE_ARTICLE_DRAFTED
      ],
      'Drafting is audited.'
    );
  }

  @IsTest
  static void draftArticleDeclinesWhenTheRecapCannotSupportOne() {
    Codify_TestUtil.stubTaxonomy();
    Codify_ResolutionParse parse = Codify_ExtractionService.parse(
      Codify_TestUtil.NO_STEPS_RECAP
    );
    Codify_Resolution_Log__c log = new Codify_Resolution_Log__c(
      Resolution_Recap__c = Codify_TestUtil.NO_STEPS_RECAP,
      Root_Cause_Category__c = 'Firmware Out of Date',
      Root_Cause_Key__c = 'Firmware_Out_Of_Date',
      Extraction_JSON__c = parse.toJsonString()
    );
    insert log;

    Codify_DraftArticleInvocable.Request req = new Codify_DraftArticleInvocable.Request();
    req.resolutionLogId = log.Id;

    Test.startTest();
    Codify_DraftArticleInvocable.Response r = Codify_DraftArticleInvocable.run(
      new List<Codify_DraftArticleInvocable.Request>{ req }
    )[0];
    Test.stopTest();

    Assert.isFalse(
      r.drafted,
      'A diagnosis with no steps should not become an article.'
    );
    Assert.areEqual(
      0,
      [SELECT COUNT() FROM Knowledge__kav],
      'Nothing should have been created.'
    );
  }

  @IsTest
  static void draftArticleCanBeForcedButStillLandsInDraft() {
    Codify_TestUtil.stubTaxonomy();
    Codify_ResolutionParse parse = Codify_ExtractionService.parse(
      Codify_TestUtil.NO_STEPS_RECAP
    );
    Codify_Resolution_Log__c log = new Codify_Resolution_Log__c(
      Resolution_Recap__c = Codify_TestUtil.NO_STEPS_RECAP,
      Root_Cause_Category__c = 'Firmware Out of Date',
      Root_Cause_Key__c = 'Firmware_Out_Of_Date',
      Extraction_JSON__c = parse.toJsonString()
    );
    insert log;

    Codify_DraftArticleInvocable.Request req = new Codify_DraftArticleInvocable.Request();
    req.resolutionLogId = log.Id;
    req.forceDraft = true;
    req.articleTitle = 'Firmware update procedure';

    Test.startTest();
    Codify_DraftArticleInvocable.Response r = Codify_DraftArticleInvocable.run(
      new List<Codify_DraftArticleInvocable.Request>{ req }
    )[0];
    Test.stopTest();

    Assert.isTrue(r.drafted, 'Forcing should override the worthiness check.');
    Knowledge__kav article = [
      SELECT PublishStatus, Title
      FROM Knowledge__kav
      WHERE Id = :r.articleId
    ];
    Assert.areEqual(
      'Draft',
      article.PublishStatus,
      'Forcing must never bypass review.'
    );
    Assert.areEqual(
      'Firmware update procedure',
      article.Title,
      'A supplied title should be used.'
    );
  }

  @IsTest
  static void draftArticleDoesNotDuplicateAnExistingDraft() {
    Codify_TestUtil.stubTaxonomy();
    Codify_ResolutionParse parse = Codify_ExtractionService.parse(
      Codify_TestUtil.RICH_RECAP
    );
    Codify_Resolution_Log__c log = new Codify_Resolution_Log__c(
      Resolution_Recap__c = Codify_TestUtil.RICH_RECAP,
      Root_Cause_Category__c = 'Firmware Out of Date',
      Root_Cause_Key__c = 'Firmware_Out_Of_Date',
      Extraction_JSON__c = parse.toJsonString()
    );
    insert log;

    Codify_DraftArticleInvocable.Request req = new Codify_DraftArticleInvocable.Request();
    req.resolutionLogId = log.Id;

    Test.startTest();
    Codify_DraftArticleInvocable.run(
      new List<Codify_DraftArticleInvocable.Request>{ req }
    );
    Codify_DraftArticleInvocable.Response second = Codify_DraftArticleInvocable.run(
      new List<Codify_DraftArticleInvocable.Request>{ req }
    )[0];
    Test.stopTest();

    Assert.isFalse(
      second.drafted,
      'A second run should not create a duplicate.'
    );
    Assert.areEqual(
      1,
      [SELECT COUNT() FROM Knowledge__kav],
      'The review queue must not fill with near-duplicates.'
    );
  }

  @IsTest
  static void draftArticleFailsCleanlyOnBadLogId() {
    Codify_DraftArticleInvocable.Request req = new Codify_DraftArticleInvocable.Request();
    req.resolutionLogId = 'nonsense';
    Codify_DraftArticleInvocable.Response r = Codify_DraftArticleInvocable.run(
      new List<Codify_DraftArticleInvocable.Request>{ req }
    )[0];
    Assert.isFalse(r.success, 'An invalid id should fail cleanly.');
  }
}
