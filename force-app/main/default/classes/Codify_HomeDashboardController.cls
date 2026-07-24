/**
 * Controller for codifyHomeDashboard and codifyRootCauseTrends. Read-only
 * aggregate rollups. The metrics are chosen to answer the question the brief
 * actually poses: is the knowledge base growing from real fixes? So it reports
 * articles drafted against articles published, not just raw activity, and it
 * surfaces low-confidence escalations rather than hiding them.
 */
public with sharing class Codify_HomeDashboardController {
  public class Tally {
    @AuraEnabled
    public String label;
    @AuraEnabled
    public Integer count;
    public Tally(String label, Integer count) {
      this.label = label;
      this.count = count;
    }
  }

  public class Summary {
    @AuraEnabled
    public Integer resolutionsThisWeek = 0;
    @AuraEnabled
    public Integer resolutionsAllTime = 0;
    @AuraEnabled
    public Integer articlesDrafted = 0;
    @AuraEnabled
    public Integer articlesPending = 0;
    @AuraEnabled
    public Integer casesFlagged = 0;
    @AuraEnabled
    public Integer escalations = 0;
    @AuraEnabled
    public List<Tally> topRootCauses = new List<Tally>();
    @AuraEnabled
    public List<Tally> topTechnicians = new List<Tally>();
    @AuraEnabled
    public List<Tally> byChangeType = new List<Tally>();
    @AuraEnabled
    public List<Tally> trend = new List<Tally>();
  }

  /** One root cause's footprint: how often it recurs and what it has produced. */
  public class RootCauseTrend {
    @AuraEnabled
    public String rootCause;
    @AuraEnabled
    public Integer occurrences;
    @AuraEnabled
    public Integer articlesDrafted;
    @AuraEnabled
    public Integer relatedCasesFlagged;
    @AuraEnabled
    public Datetime lastSeen;
  }

  @AuraEnabled(cacheable=true)
  public static Summary getSummary() {
    Summary s = new Summary();

    s.resolutionsThisWeek = [
      SELECT COUNT()
      FROM Codify_Resolution_Log__c
      WHERE CreatedDate = THIS_WEEK
    ];
    s.resolutionsAllTime = [SELECT COUNT() FROM Codify_Resolution_Log__c];
    s.articlesDrafted = [
      SELECT COUNT()
      FROM Codify_Resolution_Log__c
      WHERE Article_Drafted__c = TRUE
    ];
    s.escalations = [
      SELECT COUNT()
      FROM Codify_Change_Log__c
      WHERE
        Change_Type__c = :Codify_Constants.CHANGE_ESCALATED_FOR_REVIEW
        AND CreatedDate = THIS_WEEK
    ];
    s.casesFlagged = [
      SELECT COUNT()
      FROM Codify_Change_Log__c
      WHERE
        Change_Type__c = :Codify_Constants.CHANGE_RELATED_CASE_FLAGGED
        AND CreatedDate = THIS_WEEK
    ];
    s.articlesPending = countPendingDrafts();

    for (AggregateResult ar : [
      SELECT Root_Cause_Category__c cause, COUNT(Id) cnt
      FROM Codify_Resolution_Log__c
      WHERE Root_Cause_Category__c != NULL AND CreatedDate = LAST_N_DAYS:90
      GROUP BY Root_Cause_Category__c
      ORDER BY COUNT(Id) DESC
      LIMIT 8
    ]) {
      s.topRootCauses.add(
        new Tally((String) ar.get('cause'), (Integer) ar.get('cnt'))
      );
    }

    for (AggregateResult ar : [
      SELECT Logged_By_Technician__r.Name techName, COUNT(Id) cnt
      FROM Codify_Resolution_Log__c
      WHERE CreatedDate = THIS_WEEK AND Logged_By_Technician__c != NULL
      GROUP BY Logged_By_Technician__r.Name
      ORDER BY COUNT(Id) DESC
      LIMIT 5
    ]) {
      s.topTechnicians.add(
        new Tally((String) ar.get('techName'), (Integer) ar.get('cnt'))
      );
    }

    for (AggregateResult ar : [
      SELECT Change_Type__c ct, COUNT(Id) cnt
      FROM Codify_Change_Log__c
      WHERE CreatedDate = THIS_WEEK AND Change_Type__c != NULL
      GROUP BY Change_Type__c
      ORDER BY COUNT(Id) DESC
    ]) {
      s.byChangeType.add(
        new Tally((String) ar.get('ct'), (Integer) ar.get('cnt'))
      );
    }

    // 7-day trend of resolutions logged, oldest first, zero-filled so the
    // chart shows quiet days instead of silently compressing them away.
    Map<Date, Integer> counts = new Map<Date, Integer>();
    for (AggregateResult ar : [
      SELECT DAY_ONLY(CreatedDate) d, COUNT(Id) cnt
      FROM Codify_Resolution_Log__c
      WHERE CreatedDate = LAST_N_DAYS:7
      GROUP BY DAY_ONLY(CreatedDate)
    ]) {
      counts.put((Date) ar.get('d'), (Integer) ar.get('cnt'));
    }
    for (Integer i = 6; i >= 0; i--) {
      Date d = Date.today().addDays(-i);
      s.trend.add(
        new Tally(d.format(), counts.containsKey(d) ? counts.get(d) : 0)
      );
    }
    return s;
  }

  /**
   * Which root causes are recurring most, and what each has produced. Ties the
   * Root Cause Trends tab back to Related Case Sweep activity so a recurring
   * cause that keeps flagging Cases is visibly a candidate for a fix upstream,
   * not just a label that keeps appearing.
   */
  @AuraEnabled(cacheable=true)
  public static List<RootCauseTrend> getRootCauseTrends(Integer daysBack) {
    Integer window = (daysBack == null || daysBack <= 0) ? 90 : daysBack;
    Datetime since = Datetime.now().addDays(-window);

    Map<String, RootCauseTrend> byCause = new Map<String, RootCauseTrend>();
    for (Codify_Resolution_Log__c log : [
      SELECT
        Root_Cause_Category__c,
        Article_Drafted__c,
        Related_Cases_Flagged__c,
        CreatedDate
      FROM Codify_Resolution_Log__c
      WHERE Root_Cause_Category__c != NULL AND CreatedDate >= :since
      ORDER BY CreatedDate DESC
      LIMIT 5000
    ]) {
      RootCauseTrend t = byCause.get(log.Root_Cause_Category__c);
      if (t == null) {
        t = new RootCauseTrend();
        t.rootCause = log.Root_Cause_Category__c;
        t.occurrences = 0;
        t.articlesDrafted = 0;
        t.relatedCasesFlagged = 0;
        t.lastSeen = log.CreatedDate;
        byCause.put(log.Root_Cause_Category__c, t);
      }
      t.occurrences++;
      if (log.Article_Drafted__c == true) {
        t.articlesDrafted++;
      }
      if (log.Related_Cases_Flagged__c != null) {
        t.relatedCasesFlagged += Integer.valueOf(log.Related_Cases_Flagged__c);
      }
      if (log.CreatedDate > t.lastSeen) {
        t.lastSeen = log.CreatedDate;
      }
    }

    List<RootCauseTrend> out = byCause.values();
    // Most recurrent first; that is the ordering the tab exists to show.
    for (Integer i = 0; i < out.size(); i++) {
      for (Integer j = i + 1; j < out.size(); j++) {
        if (out[j].occurrences > out[i].occurrences) {
          RootCauseTrend tmp = out[i];
          out[i] = out[j];
          out[j] = tmp;
        }
      }
    }
    return out;
  }

  /**
   * Knowledge drafts still awaiting a human. Queried defensively because
   * Knowledge may not be enabled in every org this deploys to, and a dashboard
   * tile is not worth failing the whole page over.
   */
  private static Integer countPendingDrafts() {
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
        'Codify: pending draft count unavailable: ' + e.getMessage()
      );
      return 0;
    }
  }
}
