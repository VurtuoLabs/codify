/**
 * Second seeding pass: stands in for the human steps.
 *
 * Split from seed-demo-data.apex for two reasons. Practically, the first pass is
 * close to the DML limit for one anonymous execution. Conceptually, publishing
 * is a *human* decision that Codify deliberately cannot make - so it belongs in
 * a separate script that represents a Knowledge owner working the review queue,
 * not in the one that represents the agent.
 *
 * Publishes some drafts and leaves the rest pending, so the funnel shows a real
 * drop between "drafted" and "published" and the review queue is not empty.
 * Then runs the Related Case Sweep so the reach figure is genuine.
 *
 * Run after seed-demo-data.apex:
 *   sf apex run --file scripts/apex/seed-publish-articles.apex -o <org>
 */

final String SEED_TAG = '[CodifyDemo]';

// ── Publish roughly half the queue, oldest first ────────────────────────────
List<Knowledge__kav> drafts = [
  SELECT Id, KnowledgeArticleId, Title
  FROM Knowledge__kav
  WHERE Codify_Generated__c = TRUE AND PublishStatus = 'Draft'
  ORDER BY CreatedDate ASC
];

Integer target = drafts.size() / 2;
Integer published = 0;
for (Integer i = 0; i < drafts.size() && published < target; i++) {
  try {
    KbManagement.PublishingService.publishArticle(
      drafts[i].KnowledgeArticleId,
      true
    );
    published++;
  } catch (Exception e) {
    System.debug(
      LoggingLevel.WARN,
      'SEED: could not publish ' + drafts[i].Title + ' :: ' + e.getMessage()
    );
  }
}
System.debug(
  'SEED: published=' +
    published +
    ' of ' +
    drafts.size() +
    ' drafts, ' +
    (drafts.size() - published) +
    ' left for review'
);

// ── Sweep from the best-corroborated resolutions ────────────────────────────
// Picks the highest-confidence tagged logs, which is what a technician would
// realistically have triggered, and lets the sweep decide what actually matches.
List<Codify_Resolution_Log__c> sweepFrom = [
  SELECT Id, Case__c, Root_Cause_Category__c
  FROM Codify_Resolution_Log__c
  WHERE Root_Cause_Key__c != NULL AND Low_Confidence__c = FALSE
  ORDER BY Root_Cause_Confidence__c DESC
  LIMIT 4
];

List<Codify_RelatedCaseSweepInvocable.Request> sweeps = new List<Codify_RelatedCaseSweepInvocable.Request>();
for (Codify_Resolution_Log__c log : sweepFrom) {
  Codify_RelatedCaseSweepInvocable.Request s = new Codify_RelatedCaseSweepInvocable.Request();
  s.resolutionLogId = log.Id;
  s.caseId = log.Case__c;
  sweeps.add(s);
}

Integer flagged = 0;
if (!sweeps.isEmpty()) {
  for (
    Codify_RelatedCaseSweepInvocable.Response r : Codify_RelatedCaseSweepInvocable.run(
      sweeps
    )
  ) {
    if (r.casesFlagged != null) {
      flagged += r.casesFlagged;
    }
  }
}
System.debug('SEED: related cases flagged=' + flagged);

// ── Close the resolved Cases so "Resolved via Codify" reads like real history ─
List<Case> toClose = [
  SELECT Id
  FROM Case
  WHERE
    Codify_Resolved_Via_Codify__c = TRUE
    AND IsClosed = FALSE
    AND Subject LIKE :(SEED_TAG + '%')
  LIMIT 12
];
for (Case c : toClose) {
  c.Status = 'Closed';
}
// Leave the rest open on purpose: the sweep needs open Cases to suggest onto,
// and a backlog with nothing in it would misrepresent how this looks in use.
update toClose;
System.debug('SEED: closed=' + toClose.size() + ' cases');

System.debug('SEED: complete.');
