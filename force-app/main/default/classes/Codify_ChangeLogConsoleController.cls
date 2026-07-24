/**
 * Controller for codifyChangeLogConsole and codifyCaseHistoryBadge. Read-only:
 * the change log is an audit trail, so nothing here mutates it. Filtering uses
 * bound variables (never string-concatenated user input) to stay injection-safe.
 */
public with sharing class Codify_ChangeLogConsoleController {
  public class ChangeRow {
    @AuraEnabled
    public Id id;
    @AuraEnabled
    public String name;
    @AuraEnabled
    public String changeType;
    @AuraEnabled
    public String objectApiName;
    @AuraEnabled
    public String relatedRecordId;
    @AuraEnabled
    public String relatedRecordName;
    @AuraEnabled
    public String fieldName;
    @AuraEnabled
    public String oldValue;
    @AuraEnabled
    public String newValue;
    @AuraEnabled
    public String technicianName;
    @AuraEnabled
    public Id sourceResolutionLogId;
    @AuraEnabled
    public String sourceResolutionLogName;
    @AuraEnabled
    public String rootCause;
    @AuraEnabled
    public Boolean requiresHumanReview;
    @AuraEnabled
    public Datetime createdDate;
  }

  public class FilterOptions {
    @AuraEnabled
    public List<Map<String, String>> technicians = new List<Map<String, String>>();
    @AuraEnabled
    public List<String> rootCauses = new List<String>();
    @AuraEnabled
    public List<String> changeTypes = new List<String>();
  }

  /**
   * The console's main query. Filterable by technician, Case, root cause and
   * change type, which are the four axes service ops actually investigates
   * along ("what did this tech do", "what happened on this Case", "what is
   * this root cause producing", "show me only the drafts").
   */
  @AuraEnabled(cacheable=true)
  public static List<ChangeRow> getChanges(
    String technicianId,
    String caseId,
    String rootCause,
    String changeType,
    Date startDate,
    Date endDate,
    Integer maxRows
  ) {
    Integer lim = (maxRows == null ||
      maxRows <= 0 ||
      maxRows > 2000)
      ? 200
      : maxRows;

    String soql =
      'SELECT Id, Name, Change_Type__c, Object_API_Name__c, Related_Record_Id__c, ' +
      'Related_Record_Name__c, Field_Name__c, Old_Value__c, New_Value__c, ' +
      'Created_By_Technician__r.Name, Source_Resolution_Log__c, Source_Resolution_Log__r.Name, ' +
      'Source_Resolution_Log__r.Root_Cause_Category__c, Requires_Human_Review__c, CreatedDate ' +
      'FROM Codify_Change_Log__c';

    List<String> clauses = new List<String>();
    Id techFilter = Codify_Util.toIdOrNull(technicianId);
    String caseFilter = String.isBlank(caseId) ? null : caseId.trim();
    Datetime startDt = startDate == null
      ? null
      : Datetime.newInstance(startDate, Time.newInstance(0, 0, 0, 0));
    Datetime endDt = endDate == null
      ? null
      : Datetime.newInstance(endDate.addDays(1), Time.newInstance(0, 0, 0, 0));

    if (techFilter != null) {
      clauses.add('Created_By_Technician__c = :techFilter');
    }
    if (String.isNotBlank(caseFilter)) {
      clauses.add('Related_Record_Id__c = :caseFilter');
    }
    if (String.isNotBlank(rootCause)) {
      clauses.add(
        'Source_Resolution_Log__r.Root_Cause_Category__c = :rootCause'
      );
    }
    if (String.isNotBlank(changeType)) {
      clauses.add('Change_Type__c = :changeType');
    }
    if (startDate != null) {
      clauses.add('CreatedDate >= :startDt');
    }
    if (endDate != null) {
      clauses.add('CreatedDate <= :endDt');
    }

    if (!clauses.isEmpty()) {
      soql += ' WHERE ' + String.join(clauses, ' AND ');
    }
    soql += ' ORDER BY CreatedDate DESC LIMIT :lim';

    List<ChangeRow> rows = new List<ChangeRow>();
    for (
      Codify_Change_Log__c c : (List<Codify_Change_Log__c>) Database.query(soql)
    ) {
      rows.add(toRow(c));
    }
    return rows;
  }

  /** Every change Codify made to one record, for the Case badge. */
  @AuraEnabled(cacheable=true)
  public static List<ChangeRow> getChangesForRecord(String recordId) {
    List<ChangeRow> rows = new List<ChangeRow>();
    if (String.isBlank(recordId)) {
      return rows;
    }
    for (Codify_Change_Log__c c : [
      SELECT
        Id,
        Name,
        Change_Type__c,
        Object_API_Name__c,
        Related_Record_Id__c,
        Related_Record_Name__c,
        Field_Name__c,
        Old_Value__c,
        New_Value__c,
        Created_By_Technician__r.Name,
        Source_Resolution_Log__c,
        Source_Resolution_Log__r.Name,
        Source_Resolution_Log__r.Root_Cause_Category__c,
        Requires_Human_Review__c,
        CreatedDate
      FROM Codify_Change_Log__c
      WHERE Related_Record_Id__c = :recordId
      ORDER BY CreatedDate DESC
      LIMIT 200
    ]) {
      rows.add(toRow(c));
    }
    return rows;
  }

  @AuraEnabled(cacheable=true)
  public static Integer countForRecord(String recordId) {
    if (String.isBlank(recordId)) {
      return 0;
    }
    return [
      SELECT COUNT()
      FROM Codify_Change_Log__c
      WHERE Related_Record_Id__c = :recordId
    ];
  }

  @AuraEnabled(cacheable=true)
  public static FilterOptions getFilterOptions() {
    FilterOptions opts = new FilterOptions();
    Set<Id> techIds = new Set<Id>();
    Set<String> causes = new Set<String>();

    for (Codify_Change_Log__c c : [
      SELECT
        Created_By_Technician__c,
        Created_By_Technician__r.Name,
        Source_Resolution_Log__r.Root_Cause_Category__c
      FROM Codify_Change_Log__c
      WHERE CreatedDate = LAST_N_DAYS:180
      LIMIT 5000
    ]) {
      if (
        c.Created_By_Technician__c != null &&
        !techIds.contains(c.Created_By_Technician__c)
      ) {
        techIds.add(c.Created_By_Technician__c);
        opts.technicians.add(
          new Map<String, String>{
            'value' => c.Created_By_Technician__c,
            'label' => c.Created_By_Technician__r.Name
          }
        );
      }
      if (
        c.Source_Resolution_Log__c != null &&
        String.isNotBlank(c.Source_Resolution_Log__r.Root_Cause_Category__c)
      ) {
        causes.add(c.Source_Resolution_Log__r.Root_Cause_Category__c);
      }
    }

    opts.rootCauses = new List<String>(causes);
    opts.rootCauses.sort();
    opts.changeTypes = new List<String>{
      Codify_Constants.CHANGE_RESOLUTION_LOGGED,
      Codify_Constants.CHANGE_CASE_FIELD_UPDATE,
      Codify_Constants.CHANGE_ROOT_CAUSE_TAGGED,
      Codify_Constants.CHANGE_ARTICLE_DRAFTED,
      Codify_Constants.CHANGE_RELATED_CASE_FLAGGED,
      Codify_Constants.CHANGE_ESCALATED_FOR_REVIEW
    };
    return opts;
  }

  private static ChangeRow toRow(Codify_Change_Log__c c) {
    ChangeRow row = new ChangeRow();
    row.id = c.Id;
    row.name = c.Name;
    row.changeType = c.Change_Type__c;
    row.objectApiName = c.Object_API_Name__c;
    row.relatedRecordId = c.Related_Record_Id__c;
    row.relatedRecordName = c.Related_Record_Name__c;
    row.fieldName = c.Field_Name__c;
    row.oldValue = c.Old_Value__c;
    row.newValue = c.New_Value__c;
    row.technicianName = c.Created_By_Technician__r.Name;
    row.sourceResolutionLogId = c.Source_Resolution_Log__c;
    row.sourceResolutionLogName = c.Source_Resolution_Log__r.Name;
    row.rootCause = c.Source_Resolution_Log__r.Root_Cause_Category__c;
    row.requiresHumanReview = c.Requires_Human_Review__c;
    row.createdDate = c.CreatedDate;
    return row;
  }
}
