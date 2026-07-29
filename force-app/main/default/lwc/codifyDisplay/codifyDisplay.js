/**
 * Shared display helpers for the Codify app.
 *
 * A JS-only module rather than a component: these are pure functions that three
 * or more surfaces need to agree on. Chief among them is error handling - every
 * Codify surface has to say the same plain-language thing when the same Apex
 * failure happens, and every one of them has to keep the raw text for whoever
 * has to debug it.
 */

/**
 * How each audited change type is presented. One map, so a "Resolution Logged"
 * row looks and reads the same on the dashboard timeline, in the change log
 * console and on the Case badge.
 */
const CHANGE_META = {
  "Resolution Logged": {
    icon: "utility:record_create",
    tone: "accent",
    short: "Resolution logged"
  },
  "Case Field Update": {
    icon: "utility:edit",
    tone: "accent",
    short: "Case field updated"
  },
  "Root Cause Tagged": {
    icon: "utility:tag",
    tone: "accent",
    short: "Root cause tagged"
  },
  "Article Drafted": {
    icon: "utility:knowledge_base",
    tone: "info",
    short: "Article drafted"
  },
  "Related Case Flagged": {
    icon: "utility:share",
    tone: "good",
    short: "Related Case flagged"
  },
  "Escalated for Review": {
    icon: "utility:priority",
    tone: "pending",
    short: "Escalated for review"
  }
};

const FALLBACK_META = {
  icon: "utility:change_record_type",
  tone: "neutral",
  short: "Change"
};

/** Presentation for a change type, never undefined. */
export function changeMeta(changeType) {
  return CHANGE_META[changeType] || FALLBACK_META;
}

/**
 * One sentence describing what a change row actually did. Field updates read as
 * a before/after; everything else names the record it touched.
 */
export function describeChange(row) {
  if (!row) {
    return "";
  }
  const isFieldEdit =
    row.changeType === "Case Field Update" ||
    row.changeType === "Root Cause Tagged";
  if (isFieldEdit && row.fieldName) {
    return `${row.fieldName} set to "${row.newValue || "(blank)"}"`;
  }
  return row.relatedRecordName
    ? `${changeMeta(row.changeType).short}: ${row.relatedRecordName}`
    : changeMeta(row.changeType).short;
}

/** The raw message from an Apex or JS error, flattened for logging. */
export function rawErrorText(error) {
  if (!error) {
    return "";
  }
  if (typeof error === "string") {
    return error;
  }
  if (Array.isArray(error.body)) {
    return error.body.map((e) => e.message).join(" | ");
  }
  return (
    error.body?.message ||
    error.body?.pageErrors?.[0]?.message ||
    error.message ||
    error.statusText ||
    JSON.stringify(error)
  );
}

/**
 * Turn an Apex or platform failure into something a Knowledge owner can act on,
 * while handing the original text back for diagnostics.
 *
 * AuraHandledException messages are already written for a person - the Apex
 * controllers here throw things like "That article could not be found." - so
 * those are passed through untouched rather than being flattened into a generic
 * apology.
 */
export function reduceApexError(error, fallback) {
  const raw = rawErrorText(error);
  const lower = raw.toLowerCase();
  let message = raw;

  if (!raw) {
    message = fallback || "Something went wrong.";
  } else if (
    lower.includes("insufficient") ||
    lower.includes("not accessible") ||
    lower.includes("no access")
  ) {
    message =
      "You do not have access to some of the records Codify needs here. Ask an administrator to check the Codify Reviewer permission set.";
  } else if (
    lower.includes("knowledge__kav") ||
    lower.includes("is not supported")
  ) {
    message =
      "Knowledge does not look enabled in this org, so there is nothing for Codify to review yet.";
  } else if (
    lower.includes("too many soql") ||
    lower.includes("limitexception")
  ) {
    message =
      "This view asked for more data than Salesforce allows in one go. Narrow the filters and try again.";
  } else if (
    lower.includes("failed to fetch") ||
    lower.includes("network") ||
    lower.includes("timed out")
  ) {
    message =
      "Codify could not reach Salesforce. Check your connection and try again - nothing has been changed.";
  } else if (lower.includes("script-thrown exception")) {
    message = fallback || "Codify could not complete that.";
  }

  return { message, detail: raw };
}

/** Log the original error where a developer will find it, never on screen. */
export function logError(context, error) {
  console.error(`[Codify] ${context}:`, error);
}

/** "3 changes" / "1 change" without a plural bug at every call site. */
export function pluralise(count, singular, plural) {
  const n = Number(count) || 0;
  return `${n} ${n === 1 ? singular : plural || `${singular}s`}`;
}
