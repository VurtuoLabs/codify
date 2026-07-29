/**
 * Topic 3, Draft Knowledge Article. Takes the resolution recap and drafts a
 * Knowledge article in the org's standard template.
 *
 * The hard rule this class exists to enforce: a Codify draft NEVER publishes.
 * That is not a configuration option and there is no input that turns it off.
 * The enforcement is structural rather than conditional, this class inserts a
 * Knowledge__kav (which the platform creates in Draft) and never calls
 * KbManagement.PublishingService, so there is no code path, flag, or malformed
 * agent input that could publish one. A wrong self-service article reaching
 * customers is a real risk, and a human Knowledge owner reviews every draft
 * through the org's native publishing process before it goes live.
 *
 * It also declines to draft at all when the recap does not support an article:
 * a confident root cause with no described steps produces something a reader
 * cannot follow, which is worse for the knowledge base than nothing.
 */
public with sharing class Codify_DraftArticleInvocable {
  public class Request {
    @InvocableVariable(
      label='Resolution Log Id'
      required=true
      description='The recap to draft from. The cached extraction on this log is reused rather than re-parsed.'
    )
    public String resolutionLogId;

    @InvocableVariable(
      label='Case Id'
      description='The Case whose fix this article documents.'
    )
    public String caseId;

    @InvocableVariable(
      label='Article Title'
      description='Optional title supplied by the technician. When blank, one is derived from the symptom and root cause.'
    )
    public String articleTitle;

    @InvocableVariable(
      label='Force Draft'
      description='Draft even when the recap scored as not article-worthy, for when a technician insists the fix is worth documenting. Never bypasses review, only the worthiness check.'
    )
    public Boolean forceDraft;

    @InvocableVariable(label='Technician User Id')
    public String technicianUserId;
  }

  public class Response {
    @InvocableVariable
    public Boolean success;
    @InvocableVariable
    public Boolean drafted;
    @InvocableVariable
    public String articleId;
    @InvocableVariable
    public String articleTitle;
    @InvocableVariable
    public String publishStatus;
    @InvocableVariable
    public Boolean requiresHumanReview;
    @InvocableVariable
    public String summary;
  }

  @InvocableMethod(
    label='Codify: Draft Knowledge Article'
    description='Drafts a Knowledge article from the recap. Always lands in Draft for human review, never published.'
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
    r.drafted = false;
    r.requiresHumanReview = true;

    Id technicianId = Codify_Util.toIdOrRunningUser(req.technicianUserId);
    Id logId = Codify_Util.toIdOrNull(req.resolutionLogId);

    if (logId == null) {
      r.success = false;
      r.summary = 'No valid resolution log id was supplied, so there was no recap to draft from.';
      return r;
    }

    List<Codify_Resolution_Log__c> logs = [
      SELECT
        Id,
        Name,
        Case__c,
        Case__r.CaseNumber,
        Case__r.Subject,
        Resolution_Recap__c,
        Resolution_Summary__c,
        Root_Cause_Category__c,
        Root_Cause_Key__c,
        Article_Drafted__c,
        Knowledge_Article_Id__c,
        Extraction_JSON__c
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

    // One recap produces one draft. Re-running the topic should not litter the
    // review queue with near-duplicate articles for a reviewer to reconcile.
    if (
      log.Article_Drafted__c == true &&
      String.isNotBlank(log.Knowledge_Article_Id__c)
    ) {
      r.articleId = log.Knowledge_Article_Id__c;
      r.summary =
        'A draft already exists for ' +
        log.Name +
        ' and is waiting in the review queue. Nothing new was created.';
      return r;
    }

    Codify_ResolutionParse parse = Codify_ExtractionService.resolve(
      logId,
      log.Resolution_Recap__c
    );
    Boolean force = req.forceDraft == true;

    if (!parse.articleWorthy && !force) {
      r.summary =
        'No article drafted. ' +
        parse.articleWorthyReason +
        ' Tell the technician plainly why, and offer to draft one anyway if they think it is worth documenting.';
      return r;
    }

    Id caseId = Codify_Util.toIdOrNull(req.caseId) != null
      ? Codify_Util.toIdOrNull(req.caseId)
      : log.Case__c;
    String title = String.isNotBlank(req.articleTitle)
      ? req.articleTitle.trim()
      : deriveTitle(parse, log);

    Knowledge__kav draft = new Knowledge__kav(
      Title = Codify_Util.clip(title, 255),
      UrlName = buildUrlName(title, log.Name),
      Summary = Codify_Util.clip(
        String.isBlank(parse.resolutionSummary)
          ? log.Resolution_Summary__c
          : parse.resolutionSummary,
        1000
      ),
      Codify_Article_Body__c = buildBody(parse, log),
      Codify_Original_Recap__c = log.Resolution_Recap__c,
      Codify_Root_Cause__c = log.Root_Cause_Category__c,
      Codify_Source_Case__c = caseId == null ? null : String.valueOf(caseId),
      Codify_Source_Resolution_Log__c = String.valueOf(log.Id),
      Codify_Generated__c = true
    );

    // Inserting a Knowledge__kav creates it in Draft. Publishing would require
    // an explicit KbManagement.PublishingService call, which this class does
    // not make anywhere. That absence is the guardrail.
    insert draft;

    update new Codify_Resolution_Log__c(
      Id = log.Id,
      Article_Drafted__c = true,
      Knowledge_Article_Id__c = String.valueOf(draft.Id)
    );

    Codify_ChangeLogService.insertLogs(
      new List<Codify_Change_Log__c>{
        Codify_ChangeLogService.buildArticleDrafted(
          draft.Id,
          title,
          log.Id,
          technicianId
        )
      }
    );

    r.drafted = true;
    r.articleId = draft.Id;
    r.articleTitle = title;
    r.publishStatus = Codify_Constants.KNOWLEDGE_DRAFT_STATUS;
    r.summary =
      'Drafted "' +
      title +
      '" from ' +
      log.Name +
      '. It is in Draft and will NOT go live until a Knowledge owner reviews and publishes it. ' +
      'Make sure the technician understands it is a draft awaiting review, not a published article.';
    return r;
  }

  /**
   * Build the article body from what the technician said. Sections come
   * straight from the extraction, and the provenance footer exists so a
   * reviewer can always see which Case and recap this came from rather than
   * having to trust the prose.
   */
  private static String buildBody(
    Codify_ResolutionParse parse,
    Codify_Resolution_Log__c log
  ) {
    List<String> parts = new List<String>();

    if (String.isNotBlank(parse.symptom)) {
      parts.add('<h2>Symptom</h2><p>' + esc(parse.symptom) + '</p>');
    }
    if (String.isNotBlank(log.Root_Cause_Category__c)) {
      parts.add(
        '<h2>Root cause</h2><p>' + esc(log.Root_Cause_Category__c) + '</p>'
      );
    }

    String steps = String.isNotBlank(parse.stepsTaken)
      ? parse.stepsTaken
      : parse.resolutionSummary;
    if (String.isNotBlank(steps)) {
      List<String> items = new List<String>();
      for (String s : Codify_Util.splitSentences(steps)) {
        items.add('<li>' + esc(Codify_Util.tidySentence(s)) + '</li>');
      }
      parts.add('<h2>Resolution</h2><ol>' + String.join(items, '') + '</ol>');
    }

    parts.add(
      '<h2>Source</h2><p>Drafted by Codify from resolution log ' +
        esc(log.Name) +
        (String.isBlank(log.Case__r.CaseNumber)
          ? ''
          : ' on Case ' + esc(log.Case__r.CaseNumber)) +
        '. The technician\'s original recap is retained on this article for review.</p>'
    );

    return Codify_Util.clip(String.join(parts, ''), 32000);
  }

  private static String deriveTitle(
    Codify_ResolutionParse parse,
    Codify_Resolution_Log__c log
  ) {
    String subject = log.Case__r == null ? null : log.Case__r.Subject;
    if (
      String.isNotBlank(subject) &&
      String.isNotBlank(log.Root_Cause_Category__c)
    ) {
      return subject.trim() + ' - ' + log.Root_Cause_Category__c;
    }
    if (String.isNotBlank(subject)) {
      return subject.trim();
    }
    if (String.isNotBlank(parse.symptom)) {
      return Codify_Util.clip(parse.symptom, 200);
    }
    return 'Resolution captured in ' + log.Name;
  }

  /**
   * URL names must be unique across the knowledge base, so the resolution log
   * name (itself unique) is appended rather than relying on the title.
   */
  private static String buildUrlName(String title, String logName) {
    String slug = title == null ? 'codify-draft' : title.toLowerCase();
    slug = slug.replaceAll('[^a-z0-9]+', '-').replaceAll('^-+|-+$', '');
    if (String.isBlank(slug)) {
      slug = 'codify-draft';
    }
    slug = Codify_Util.clip(slug, 200) + '-' + logName.toLowerCase();
    return Codify_Util.clip(slug, 255);
  }

  private static String esc(String s) {
    return s == null ? '' : s.escapeHtml4();
  }
}
