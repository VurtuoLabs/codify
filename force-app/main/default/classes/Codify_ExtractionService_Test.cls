/**
 * Tests for the extraction/classification engine. The cases that matter most
 * here are the negative ones: Codify refusing to classify is the behaviour the
 * whole design rests on, so it is tested at least as hard as the happy path.
 */
@IsTest
private class Codify_ExtractionService_Test {
  @IsTest
  static void classifiesConfidentlyWhenKeywordsCorroborate() {
    Codify_TestUtil.stubTaxonomy();

    Test.startTest();
    Codify_ResolutionParse parse = Codify_ExtractionService.parse(
      Codify_TestUtil.RICH_RECAP
    );
    Test.stopTest();

    Assert.isTrue(
      parse.hasRootCause(),
      'A recap naming firmware repeatedly should classify.'
    );
    Assert.areEqual(
      'Firmware_Out_Of_Date',
      parse.rootCause.key,
      'Should pick the best-scoring taxonomy row.'
    );
    Assert.isFalse(
      parse.lowConfidence,
      'A corroborated match is not low confidence.'
    );
    Assert.isTrue(
      parse.rootCause.score >= Codify_Constants.ROOT_CAUSE_CONFIDENCE_FLOOR,
      'Score must clear the floor.'
    );
  }

  @IsTest
  static void refusesToTagOnASingleKeyword() {
    Codify_TestUtil.stubTaxonomy();

    Test.startTest();
    Codify_ResolutionParse parse = Codify_ExtractionService.parse(
      Codify_TestUtil.AMBIGUOUS_RECAP
    );
    Test.stopTest();

    Assert.isFalse(
      parse.hasRootCause(),
      'One passing mention of "network" is not a diagnosis.'
    );
    Assert.isTrue(
      parse.lowConfidence,
      'An uncorroborated match must be flagged low confidence.'
    );
    Assert.isTrue(
      String.isNotBlank(parse.notes),
      'The reason for declining must be stated.'
    );
  }

  @IsTest
  static void namesRunnersUpSoEscalationIsActionable() {
    Codify_TestUtil.stubTaxonomy();

    Test.startTest();
    // Mentions one keyword each from two different taxonomy rows.
    Codify_ResolutionParse parse = Codify_ExtractionService.parse(
      'Not sure if this was a network fault or something to do with power at the site.'
    );
    Test.stopTest();

    Assert.isTrue(
      parse.lowConfidence,
      'Two single-keyword matches still should not tag.'
    );
    Assert.isFalse(
      parse.runnersUp.isEmpty(),
      'Candidates must be surfaced so a human can adjudicate.'
    );
  }

  @IsTest
  static void tooShortRecapDegradesGracefully() {
    Codify_TestUtil.stubTaxonomy();

    Test.startTest();
    Codify_ResolutionParse parse = Codify_ExtractionService.parse(
      Codify_TestUtil.THIN_RECAP
    );
    Test.stopTest();

    Assert.isTrue(
      parse.lowConfidence,
      'A two-word recap cannot be classified.'
    );
    Assert.isFalse(
      parse.articleWorthy,
      'Nothing to document from a two-word recap.'
    );
  }

  @IsTest
  static void blankRecapDoesNotThrow() {
    Codify_TestUtil.stubTaxonomy();
    Codify_ResolutionParse parse = Codify_ExtractionService.parse(null);
    Assert.isTrue(parse.lowConfidence, 'Null input must degrade, not throw.');
  }

  @IsTest
  static void refusesArticleWhenNoStepsDescribed() {
    Codify_TestUtil.stubTaxonomy();

    Test.startTest();
    Codify_ResolutionParse parse = Codify_ExtractionService.parse(
      Codify_TestUtil.NO_STEPS_RECAP
    );
    Test.stopTest();

    Assert.isTrue(parse.hasRootCause(), 'The cause is clear enough to tag.');
    Assert.isFalse(
      parse.articleWorthy,
      'A diagnosis with no steps makes an article nobody can follow.'
    );
    Assert.isTrue(
      String.isNotBlank(parse.articleWorthyReason),
      'The refusal must be explained.'
    );
  }

  @IsTest
  static void refusesArticleForNonArticleWorthyCause() {
    Codify_TestUtil.stubTaxonomy();

    Test.startTest();
    Codify_ResolutionParse parse = Codify_ExtractionService.parse(
      'The dead unit had a failed board so I replaced the whole assembly, then reset it and confirmed it came back up fine on site.'
    );
    Test.stopTest();

    Assert.isTrue(parse.hasRootCause(), 'Hardware failure should classify.');
    Assert.areEqual(
      'Hardware_Component_Failure',
      parse.rootCause.key,
      'Should match the hardware row.'
    );
    Assert.isFalse(
      parse.articleWorthy,
      'One-off hardware swaps are configured as not article-worthy.'
    );
  }

  @IsTest
  static void extractsSymptomStepsAndEvidence() {
    Codify_TestUtil.stubTaxonomy();

    Test.startTest();
    Codify_ResolutionParse parse = Codify_ExtractionService.parse(
      Codify_TestUtil.RICH_RECAP
    );
    Test.stopTest();

    Assert.isTrue(
      String.isNotBlank(parse.symptom),
      'The reported symptom should be captured.'
    );
    Assert.isTrue(
      String.isNotBlank(parse.stepsTaken),
      'The fix steps should be captured.'
    );
    Assert.isFalse(
      parse.evidence.isEmpty(),
      'Every conclusion must trace to a verbatim sentence.'
    );
    Assert.isTrue(
      parse.articleWorthy,
      'Cause plus steps plus procedure language warrants an article.'
    );
  }

  @IsTest
  static void relatedKeysSpanConfiguredNeighboursAndCategoryGroup() {
    Codify_TestUtil.stubTaxonomy();

    Test.startTest();
    Set<String> keys = Codify_ExtractionService.relatedKeysFor(
      'Network_Connectivity'
    );
    Test.stopTest();

    Assert.isTrue(
      keys.contains('Network_Connectivity'),
      'The cause itself is always included.'
    );
    Assert.isTrue(
      keys.contains('Power_Supply'),
      'Same category group counts as closely related.'
    );
    Assert.isFalse(
      keys.contains('Configuration_Error'),
      'An unrelated cause must not be swept in.'
    );
  }

  @IsTest
  static void relatedKeysForBlankReturnsEmpty() {
    Codify_TestUtil.stubTaxonomy();
    Assert.isTrue(
      Codify_ExtractionService.relatedKeysFor('').isEmpty(),
      'Blank key means no sweep targets.'
    );
  }

  @IsTest
  static void resolveReusesTheCachedParseRatherThanReparsing() {
    Codify_TestUtil.stubTaxonomy();
    Account a = Codify_TestUtil.account();
    Case c = Codify_TestUtil.openCase(a.Id, 'Controller offline');

    // Cache a parse that deliberately disagrees with the raw text, so a
    // re-parse would produce a different answer and the test would fail.
    Codify_ResolutionParse cached = new Codify_ResolutionParse();
    cached.resolutionSummary = 'CACHED SUMMARY';
    Codify_Resolution_Log__c log = new Codify_Resolution_Log__c(
      Case__c = c.Id,
      Resolution_Recap__c = Codify_TestUtil.RICH_RECAP,
      Extraction_JSON__c = cached.toJsonString()
    );
    insert log;

    Test.startTest();
    Codify_ResolutionParse resolved = Codify_ExtractionService.resolve(
      log.Id,
      null
    );
    Test.stopTest();

    Assert.areEqual(
      'CACHED SUMMARY',
      resolved.resolutionSummary,
      'The cached parse must win over re-parsing.'
    );
  }

  @IsTest
  static void resolveFallsBackToParsingWhenNoCacheExists() {
    Codify_TestUtil.stubTaxonomy();
    Account a = Codify_TestUtil.account();
    Case c = Codify_TestUtil.openCase(a.Id, 'Controller offline');
    Codify_Resolution_Log__c log = new Codify_Resolution_Log__c(
      Case__c = c.Id,
      Resolution_Recap__c = Codify_TestUtil.RICH_RECAP
    );
    insert log;

    Test.startTest();
    Codify_ResolutionParse resolved = Codify_ExtractionService.resolve(
      log.Id,
      null
    );
    Test.stopTest();

    Assert.isTrue(
      resolved.hasRootCause(),
      'With no cache it should parse the stored recap.'
    );
  }

  @IsTest
  static void malformedCacheDegradesToEmptyParse() {
    Codify_ResolutionParse parse = Codify_ResolutionParse.fromJson(
      '{not valid json'
    );
    Assert.isFalse(
      parse.hasRootCause(),
      'A corrupt cache must not break the topic.'
    );
  }

  @IsTest
  static void taxonomyByKeyFindsAndMisses() {
    Codify_TestUtil.stubTaxonomy();
    Assert.isNotNull(
      Codify_ExtractionService.taxonomyByKey('Power_Supply'),
      'Known key should resolve.'
    );
    Assert.isNull(
      Codify_ExtractionService.taxonomyByKey('Not_A_Real_Key'),
      'Unknown key should return null.'
    );
    Assert.isNull(
      Codify_ExtractionService.taxonomyByKey(null),
      'Null key should return null.'
    );
  }

  @IsTest
  static void utilHelpersDegradeOnBadInput() {
    Assert.isNull(
      Codify_Util.toIdOrNull('not-an-id'),
      'Invalid ids return null rather than throwing.'
    );
    Assert.isNull(Codify_Util.toIdOrNull(''), 'Blank ids return null.');
    Assert.areEqual(
      UserInfo.getUserId(),
      Codify_Util.toIdOrRunningUser(null),
      'Blank user id falls back to running user.'
    );
    Assert.areEqual('ab', Codify_Util.clip('abcdef', 2), 'clip truncates.');
    Assert.isNull(Codify_Util.clip(null, 5), 'clip tolerates null.');
    Assert.isTrue(
      Codify_Util.splitKeywords(null).isEmpty(),
      'Blank keyword config yields no tokens.'
    );
    Assert.areEqual(
      2,
      Codify_Util.splitKeywords('a, b,  ,').size(),
      'Empty tokens are dropped.'
    );
    Assert.isTrue(
      Codify_Util.splitSentences(null).isEmpty(),
      'Null text yields no sentences.'
    );
    Assert.areEqual(
      '',
      Codify_Util.tidySentence(null),
      'tidySentence tolerates null.'
    );
    Assert.areEqual(
      'Hello',
      Codify_Util.tidySentence('- hello'),
      'Bullets are trimmed and text sentence-cased.'
    );
  }
}
