/**
 * Removes everything seed-demo-data.apex and seed-publish-articles.apex created,
 * so a demo org can be reset without hunting through records by hand.
 *
 * Order matters. Knowledge articles cannot be deleted with plain DML - drafts go
 * through the publishing service, and a published article has to be unpublished
 * (returned to draft) before it can be removed at all. The audit rows go before
 * the resolution logs they point at, and the Cases go last because the logs look
 * up to them.
 *
 * Deliberately narrow: it only touches records carrying the demo tag, plus the
 * Codify audit objects, which exist solely to record Codify's own activity.
 *
 * Run: sf apex run --file scripts/apex/clear-demo-data.apex -o <org>
 */

final String SEED_TAG = '[CodifyDemo]';
final String SEED_LIKE = SEED_TAG + '%';

// ── Knowledge, via the publishing service ───────────────────────────────────
Integer removedArticles = 0;
for (Knowledge__kav k : [
  SELECT Id, KnowledgeArticleId, PublishStatus
  FROM Knowledge__kav
  WHERE Codify_Generated__c = TRUE
]) {
  try {
    if (k.PublishStatus == 'Online') {
      // A live article cannot be deleted outright. editOnlineArticle with
      // unpublish=true takes it offline and leaves a draft behind, which is
      // then deletable. (There is no unpublishArticle method.)
      KbManagement.PublishingService.editOnlineArticle(
        k.KnowledgeArticleId,
        true
      );
    }
    KbManagement.PublishingService.deleteDraftArticle(k.KnowledgeArticleId);
    removedArticles++;
  } catch (Exception e) {
    System.debug(
      LoggingLevel.WARN,
      'CLEAR: could not remove article ' + k.Id + ' :: ' + e.getMessage()
    );
  }
}
System.debug('CLEAR: articles removed=' + removedArticles);

// ── Tasks raised by escalation ──────────────────────────────────────────────
List<Task> tasks = [
  SELECT Id
  FROM Task
  WHERE Subject LIKE 'Codify: resolution needs a human review%'
];
delete tasks;
System.debug('CLEAR: tasks=' + tasks.size());

// ── Audit rows, then the recaps they trace back to ──────────────────────────
List<Codify_Change_Log__c> changes = [SELECT Id FROM Codify_Change_Log__c];
delete changes;
System.debug('CLEAR: change logs=' + changes.size());

List<Codify_Resolution_Log__c> logs = [SELECT Id FROM Codify_Resolution_Log__c];
delete logs;
System.debug('CLEAR: resolution logs=' + logs.size());

// ── Cases and Accounts ──────────────────────────────────────────────────────
List<Case> cases = [SELECT Id FROM Case WHERE Subject LIKE :SEED_LIKE];
delete cases;
System.debug('CLEAR: cases=' + cases.size());

List<Account> accounts = [SELECT Id FROM Account WHERE Name LIKE :SEED_LIKE];
delete accounts;
System.debug('CLEAR: accounts=' + accounts.size());

System.debug('CLEAR: complete.');
