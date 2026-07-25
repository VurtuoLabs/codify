/**
 * Seeds demo data for the Codify dashboards.
 *
 * Deliberately does NOT insert rows into the audit objects directly. It drives
 * the real invocables with realistic recaps, so everything downstream — the
 * cached extraction, the change-log rows, the confidence scores, which fixes
 * were judged article-worthy — is produced by Codify rather than fabricated.
 * That means the dashboards show the system's actual behaviour, and it doubles
 * as an end-to-end exercise of the whole pipeline.
 *
 * Some recaps here are deliberately vague. They are not filler: the "waiting on
 * a human" panel is only honest if some recaps really did fail to classify.
 *
 * Everything created is tagged with SEED_TAG so clear-demo-data.apex can find
 * and remove it.
 *
 * Run:  sf apex run --file scripts/apex/seed-demo-data.apex -o <org>
 * Then: sf apex run --file scripts/apex/seed-publish-articles.apex -o <org>
 *
 * NOTE ON THE TREND CHART: CreatedDate is not writable, so every record lands
 * today and the 7-day trend shows a single column. Enabling "Set Audit Fields
 * upon Record Creation" in Setup would be needed to spread it across days.
 */

final String SEED_TAG = '[CodifyDemo]';

// ── Accounts ────────────────────────────────────────────────────────────────
List<Account> accounts = new List<Account>{
  new Account(Name = SEED_TAG + ' Northwind Facilities'),
  new Account(Name = SEED_TAG + ' Harbourside Logistics'),
  new Account(Name = SEED_TAG + ' Meridian Cold Storage')
};
insert accounts;

// ── The recaps ──────────────────────────────────────────────────────────────
// subject ||| recap. Written so the classifier has genuine corroboration to
// work with, except where the point is that it does not.
List<String> seeds = new List<String>{
  // — Confident, with steps: these should tag AND warrant an article —
  'Controller drops offline every morning|||Customer reported the controller was showing an offline error every morning. Turns out the firmware was out of date and the old version drops the connection after a reboot. First I flashed the firmware to 4.2.1, then I reset the controller and verified it stayed online for a full hour. Make sure you power cycle after flashing or the change does not take.',

  'Readings out of range at Site 12|||Site called in because the readings were wrong. The unit was misconfigured after the last service visit, the threshold parameter had been set to the wrong value. I corrected the setting, saved the configuration and confirmed the readings came back into range. Always re-check that parameter after any service work.',

  'Panel dropping connection intermittently|||Panel kept dropping offline through the day. Traced it to the network. The wifi signal at that end of the building is weak and the router had no reserved address, so the dns lookup failed each time it tried to reconnect. I moved it onto ethernet and restored connectivity. Verify it holds for ten minutes before leaving site.',

  'Sensor reading backwards after install|||Second visit to the same unit. Turns out it was installed wrong on the original job, the sensor was mounted backwards and the connector was not seated properly. I reseated it, corrected the orientation and retested against a reference. The installation guide does not call this out clearly.',

  'Whole cabinet dead on arrival|||Whole cabinet was dead when I arrived. The breaker had tripped after a surge overnight and the ups battery was flat, so nothing rode through the outage. I reset the breaker, fitted a new battery and confirmed the voltage was stable under load. This site would benefit from proper surge protection.',

  'Airflow alarm in plant room|||Airflow alarm at the plant room. The filter had not been changed in over a year, maintenance was overdue and the intake was blocked solid. I cleaned the housing, fitted a new filter and logged the service against the asset. Set a reminder so this pm does not get skipped again.',

  'Units powering up in wrong order|||Not a fault at all. The operator didn\'t know the correct start-up sequence and was powering the units in the wrong order. I walked them through it, showed them the sequence on the panel and left a laminated card by the door. Worth adding to the onboarding for new staff.',

  'Data not syncing to vendor system|||Readings stopped syncing to the customer\'s vendor system overnight. The api token expired and nobody had rotated it, so the sync failed silently with nothing in the logs. I issued new credentials, updated the integration and confirmed data was flowing again. The certificate expires in March, worth diarising.',

  'Fault took hours to diagnose|||Took far longer than it should have. There is no documentation for this variant and the manual was wrong about the reset sequence, so I had to work it out from first principles. Once I found the right procedure I cleared the fault and restored service. Someone needs to write this up properly.',

  'Unit shutting down in afternoon heat|||Unit kept shutting down in the afternoon heat. The plant room has no ventilation and the temperature was well above spec, with condensation forming on the housing. I fitted a vent, improved the airflow and it has been stable since. This will recur at other sites with the same layout.',

  'Second controller offline at Harbourside|||Same story as the unit last week. The firmware was out of date and had never been updated since commissioning, an old version with the known connection bug. I flashed it to the current release and power cycled, then confirmed it held for an hour.',

  'Flow parameter wrong after commissioning|||Another one set up wrong at commissioning. The flow parameter had the wrong value and the configuration had never been checked against the spec. I corrected the setting and verified the output against the reference meter.',

  'Intermittent dropouts at loading bay|||Dropouts at the loading bay all week. The network switch there is on a different vlan and the firewall was blocking the return path, so connectivity kept failing. I corrected the routing and reconnected. Confirmed stable for twenty minutes.',

  // — Confident cause, but no reusable procedure: should tag, no article —
  'Main board burnt out|||Dead unit on arrival, the main board had burnt out and you could smell it. I replaced the whole assembly and confirmed it came back up on site.',

  'Drive belt worn through|||Routine callout. The drive belt was badly worn and the bearing had degraded past its life. Swapped both and the vibration went away.',

  'Firmware behind on spare unit|||The firmware was out of date on this one, that was the whole problem, an old version issue.',

  // — Deliberately thin: these SHOULD fail to classify and route to a human —
  'Intermittent fault, cause unclear|||Had a look at the unit on site and it seemed like a network thing but honestly I am not certain what it was.',

  'Unit down overnight, unclear why|||Not sure if this was a power fault or something to do with the temperature in the room.',

  'Resolved on site|||Sorted it on site, back up and running now.',

  'No fault found|||Customer says it is fine now. Did not see anything obviously wrong when I got there.'
};

// ── Create the Cases ────────────────────────────────────────────────────────
List<Case> cases = new List<Case>();
for (Integer i = 0; i < seeds.size(); i++) {
  cases.add(
    new Case(
      Subject = SEED_TAG + ' ' + seeds[i].split('\\|\\|\\|')[0],
      Status = 'New',
      Origin = 'Phone',
      AccountId = accounts[Math.mod(i, accounts.size())].Id
    )
  );
}
insert cases;

// ── Run the real pipeline over each recap ───────────────────────────────────
List<Codify_LogResolutionInvocable.Request> logReqs = new List<Codify_LogResolutionInvocable.Request>();
for (Integer i = 0; i < seeds.size(); i++) {
  Codify_LogResolutionInvocable.Request q = new Codify_LogResolutionInvocable.Request();
  q.resolutionRecap = seeds[i].split('\\|\\|\\|')[1];
  q.caseId = cases[i].Id;
  q.sourceChannel = Math.mod(i, 4) == 0 ? 'Experience Cloud' : 'MIAW';
  logReqs.add(q);
}
List<Codify_LogResolutionInvocable.Response> logged = Codify_LogResolutionInvocable.run(logReqs);

Integer tagged = 0, unclassified = 0, worthy = 0;
List<Id> worthyLogIds = new List<Id>();
List<Id> unclassifiedLogIds = new List<Id>();
List<Id> unclassifiedCaseIds = new List<Id>();

for (Integer i = 0; i < logged.size(); i++) {
  Codify_LogResolutionInvocable.Response r = logged[i];
  if (r.rootCauseTagged == true) {
    tagged++;
  } else {
    unclassified++;
    unclassifiedLogIds.add(Id.valueOf(r.resolutionLogId));
    unclassifiedCaseIds.add(cases[i].Id);
  }
  if (r.articleWorthy == true) {
    worthy++;
    worthyLogIds.add(Id.valueOf(r.resolutionLogId));
  }
}
System.debug('SEED: logged=' + logged.size() + ' tagged=' + tagged + ' unclassified=' + unclassified + ' articleWorthy=' + worthy);

// ── Draft articles for the fixes that earned one ────────────────────────────
List<Codify_DraftArticleInvocable.Request> draftReqs = new List<Codify_DraftArticleInvocable.Request>();
for (Id logId : worthyLogIds) {
  Codify_DraftArticleInvocable.Request d = new Codify_DraftArticleInvocable.Request();
  d.resolutionLogId = logId;
  draftReqs.add(d);
}
Integer drafted = 0;
if (!draftReqs.isEmpty()) {
  for (Codify_DraftArticleInvocable.Response dr : Codify_DraftArticleInvocable.run(draftReqs)) {
    if (dr.drafted == true) {
      drafted++;
    }
  }
}
System.debug('SEED: drafted=' + drafted);

// ── Escalate the ones Codify would not guess at ─────────────────────────────
List<Codify_EscalateForReviewInvocable.Request> escReqs = new List<Codify_EscalateForReviewInvocable.Request>();
for (Integer i = 0; i < unclassifiedLogIds.size(); i++) {
  Codify_EscalateForReviewInvocable.Request e = new Codify_EscalateForReviewInvocable.Request();
  e.resolutionLogId = unclassifiedLogIds[i];
  e.caseId = unclassifiedCaseIds[i];
  e.reason = 'The recap did not name a cause clearly enough to classify.';
  escReqs.add(e);
}
if (!escReqs.isEmpty()) {
  Codify_EscalateForReviewInvocable.run(escReqs);
}
System.debug('SEED: escalated=' + escReqs.size());

System.debug('SEED: done. Next, run seed-publish-articles.apex to move some drafts live.');
