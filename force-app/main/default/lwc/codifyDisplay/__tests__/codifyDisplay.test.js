import {
  changeMeta,
  describeChange,
  rawErrorText,
  reduceApexError,
  pluralise
} from "c/codifyDisplay";

describe("c/codifyDisplay", () => {
  describe("changeMeta", () => {
    it("gives every known change type an icon and a tone", () => {
      const meta = changeMeta("Article Drafted");
      expect(meta.icon).toBe("utility:knowledge_base");
      expect(meta.tone).toBe("info");
    });

    it("never returns undefined for an unknown type", () => {
      const meta = changeMeta("Something New");
      expect(meta.icon).toBeTruthy();
      expect(meta.tone).toBe("neutral");
    });
  });

  describe("describeChange", () => {
    it("reads a field update as its new value", () => {
      expect(
        describeChange({
          changeType: "Case Field Update",
          fieldName: "Codify_Root_Cause__c",
          oldValue: "",
          newValue: "Firmware Out Of Date"
        })
      ).toBe('Codify_Root_Cause__c set to "Firmware Out Of Date"');
    });

    it("says (blank) rather than rendering nothing", () => {
      expect(
        describeChange({
          changeType: "Root Cause Tagged",
          fieldName: "Root_Cause__c",
          newValue: null
        })
      ).toBe('Root_Cause__c set to "(blank)"');
    });

    it("names the record for non-field changes", () => {
      expect(
        describeChange({
          changeType: "Article Drafted",
          relatedRecordName: "Resetting a stalled controller"
        })
      ).toBe("Article drafted: Resetting a stalled controller");
    });

    it("survives a missing row", () => {
      expect(describeChange(undefined)).toBe("");
    });
  });

  describe("reduceApexError", () => {
    it("keeps an AuraHandledException message, which is already human", () => {
      const { message } = reduceApexError({
        body: { message: "That article could not be found." }
      });
      expect(message).toBe("That article could not be found.");
    });

    it("translates a permissions failure into something actionable", () => {
      const { message, detail } = reduceApexError({
        body: { message: "INSUFFICIENT_ACCESS_ON_CROSS_REFERENCE_ENTITY" }
      });
      expect(message).toContain("permission set");
      // The raw text is preserved for whoever has to debug it.
      expect(detail).toBe("INSUFFICIENT_ACCESS_ON_CROSS_REFERENCE_ENTITY");
    });

    it("explains a missing Knowledge licence in plain language", () => {
      const { message } = reduceApexError({
        body: { message: "sObject type 'Knowledge__kav' is not supported" }
      });
      expect(message).toContain("Knowledge");
    });

    it("falls back to the caller's sentence when there is nothing to go on", () => {
      const { message } = reduceApexError(undefined, "Could not load figures.");
      expect(message).toBe("Could not load figures.");
    });

    it("flattens a list of page errors", () => {
      expect(
        rawErrorText({ body: [{ message: "one" }, { message: "two" }] })
      ).toBe("one | two");
    });
  });

  describe("pluralise", () => {
    it("agrees with one", () => {
      expect(pluralise(1, "change")).toBe("1 change");
    });

    it("agrees with none and many", () => {
      expect(pluralise(0, "change")).toBe("0 changes");
      expect(pluralise(4, "change")).toBe("4 changes");
    });

    it("takes an irregular plural", () => {
      expect(pluralise(2, "fix", "fixes")).toBe("2 fixes");
    });
  });
});
