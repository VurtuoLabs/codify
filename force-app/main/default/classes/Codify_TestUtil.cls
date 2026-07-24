/**
 * Shared test data factory plus in-memory taxonomy injection, so tests never
 * depend on which Codify_Root_Cause_Taxonomy__mdt rows happen to exist in the
 * org they run in. Custom metadata cannot be inserted in a test context, so the
 * extraction service exposes a test hook and this class is the only thing that
 * uses it.
 */
@IsTest
public class Codify_TestUtil {
  public static Account account() {
    Account a = new Account(Name = 'Northwind Facilities');
    insert a;
    return a;
  }

  public static Contact contact(Id accountId) {
    Contact c = new Contact(
      FirstName = 'Dana',
      LastName = 'Okafor',
      AccountId = accountId
    );
    insert c;
    return c;
  }

  public static Case openCase(Id accountId, String subject) {
    Case c = new Case(
      Subject = subject,
      Status = 'New',
      Origin = 'Web',
      AccountId = accountId
    );
    insert c;
    return c;
  }

  /** A Case already tagged with a root cause key, for sweep tests. */
  public static Case taggedCase(
    Id accountId,
    String subject,
    String rootCauseKey,
    String rootCauseLabel
  ) {
    Case c = new Case(
      Subject = subject,
      Status = 'New',
      Origin = 'Web',
      AccountId = accountId,
      Codify_Root_Cause_Key__c = rootCauseKey,
      Codify_Root_Cause__c = rootCauseLabel
    );
    insert c;
    return c;
  }

  /** Point the extraction service at a deterministic in-memory taxonomy. */
  public static void stubTaxonomy() {
    Codify_ExtractionService.testTaxonomy = new List<Codify_Root_Cause_Taxonomy__mdt>{
      row(
        'Configuration_Error',
        'Configuration Error',
        'Configuration',
        'misconfigured,wrong setting,config,configuration,parameter',
        true,
        'Incorrect_Installation',
        10
      ),
      row(
        'Firmware_Out_Of_Date',
        'Firmware Out of Date',
        'Software',
        'firmware,out of date,outdated,old version,flashed',
        true,
        'Software_Defect',
        20
      ),
      row(
        'Network_Connectivity',
        'Network Connectivity',
        'Environmental',
        'network,wifi,connectivity,offline,dns,firewall',
        true,
        'Power_Supply',
        30
      ),
      row(
        'Power_Supply',
        'Power Supply Issue',
        'Environmental',
        'power,voltage,brownout,surge,battery,breaker',
        true,
        'Network_Connectivity',
        40
      ),
      row(
        'Hardware_Component_Failure',
        'Hardware Component Failure',
        'Hardware',
        'replaced the,failed board,burnt,dead unit,faulty part',
        false,
        'Wear_And_Tear',
        50
      ),
      row(
        'Wear_And_Tear',
        'Normal Wear and Tear',
        'Hardware',
        'worn,wear and tear,degraded,corroded',
        false,
        '',
        60
      ),
      row(
        'Incorrect_Installation',
        'Incorrect Installation',
        'Process',
        'installed wrong,mounted,reversed,not seated,loose connection',
        true,
        'Configuration_Error',
        70
      )
    };
  }

  public static Codify_Root_Cause_Taxonomy__mdt row(
    String key,
    String label,
    String categoryGroup,
    String keywords,
    Boolean articleWorthy,
    String relatedKeys,
    Integer sortOrder
  ) {
    return new Codify_Root_Cause_Taxonomy__mdt(
      Root_Cause_Key__c = key,
      Root_Cause_Label__c = label,
      Category_Group__c = categoryGroup,
      Detection_Keywords__c = keywords,
      Article_Worthy__c = articleWorthy,
      Related_Keys__c = relatedKeys,
      Sort_Order__c = sortOrder,
      Is_Active__c = true
    );
  }

  /**
   * A recap with everything: a symptom, several fix steps, procedure language,
   * and two distinct keywords for one taxonomy row so it clears the floor.
   */
  public static final String RICH_RECAP =
    'Customer reported the controller was showing an offline error every morning. ' +
    'Turns out the firmware was out of date and the old version drops the connection after a reboot. ' +
    'First I flashed the firmware to 4.2.1, then I reset the controller and verified it stayed online for an hour. ' +
    'Make sure you power cycle after flashing or the change does not take.';

  /** Confident diagnosis, but no described steps, so no article should be drafted. */
  public static final String NO_STEPS_RECAP = 'The firmware was out of date on this unit, that was the whole problem here, an old version issue.';

  /** Only one keyword hits, so nothing should clear the confidence floor. */
  public static final String AMBIGUOUS_RECAP = 'Had a look at the unit on site and it seemed like a network thing but honestly I am not certain what it was.';

  /** Too short to extract anything from at all. */
  public static final String THIN_RECAP = 'fixed it';
}
