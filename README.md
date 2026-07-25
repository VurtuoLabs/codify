# Codify

**Codify is a service employee agent that captures how a Case was actually resolved and turns it into permanent, reusable knowledge.** After closing a Case, an agent or technician dictates or pastes a quick recap of the fix. Codify updates the Case's resolution fields, tags the root cause, and drafts a Knowledge article automatically, so the org's knowledge base grows from real fixes instead of depending on someone remembering to write documentation after the fact.

Unlike [Scribe](../scribe) — internal, chat-based, used by the rep directly in Agentforce — Codify is deployed over **Messaging for In-App and Web (MIAW)**, embedded in Experience Cloud, so it is usable by internal service agents working inside a portal, external field technicians without full Salesforce licences, and partner or franchise technicians who only have Experience Cloud access.

Every write Codify makes, without exception, produces a **`Codify_Change_Log__c`** row, reviewable through its own Lightning app.

---

## Table of contents

- [The problem it solves](#the-problem-it-solves)
- [Why MIAW specifically](#why-miaw-specifically)
- [Design goals](#design-goals)
- [Architecture and data flow](#architecture-and-data-flow)
- [The five agent topics](#the-five-agent-topics)
- [How the classifier decides](#how-the-classifier-decides)
- [Data model](#data-model)
- [The Codify app](#the-codify-app)
- [Component inventory](#component-inventory)
- [Guardrails](#guardrails)
- [Install and deploy](#install-and-deploy)
- [Configuration reference](#configuration-reference)
- [Testing](#testing)
- [Project structure](#project-structure)
- [Status and known environment notes](#status-and-known-environment-notes)
- [License](#license)

---

## The problem it solves

Knowledge bases go stale not because the knowledge doesn't exist, but because it exists only in the head of whoever solved the problem. The agent who diagnosed a tricky issue moves on to the next case, and the fix is never captured anywhere reusable. The next time the same issue comes in, someone else re-diagnoses it from scratch — or worse, a customer-facing self-service article never gets written at all because nobody has time to author one formally.

Codify's job is to make documentation a **byproduct of doing the work**, not a separate task someone has to remember afterward.

## Why MIAW specifically

| Reason                            | What it buys                                                                                                                                  |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Works outside full licensing**  | Field techs, franchise partners and contracted providers often hold only Experience Cloud access. MIAW reaches them without an internal seat. |
| **Embeds where the work happens** | Dropped onto an Experience Cloud Case detail page, so the tech never leaves the page they are already looking at.                             |
| **Session-based fits the job**    | A resolution recap is one synchronous exchange — dictate, confirm, done. That matches MIAW's session model, unlike async follow-up patterns.  |
| **Pre-chat context capture**      | The Case Id and Contact arrive automatically when Codify is launched from a Case record, so the tech never explains which case they mean.     |

## Design goals

| Goal                               | How Codify honors it                                                                                                                                                                                                             |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Never invent a root cause**      | The classifier requires corroboration from **two distinct** taxonomy keywords before it will tag anything. A single passing mention of "network" is not a diagnosis. Below the floor it names what it was torn between and asks. |
| **Confirm before publishing**      | Case resolution updates apply directly (internal record-keeping, low risk). Knowledge drafts **never** auto-publish — enforced structurally, see [Guardrails](#guardrails).                                                      |
| **One recap, multiple outputs**    | The recap is parsed **once** and cached on `Codify_Resolution_Log__c.Extraction_JSON__c`. Every other topic reads that cache via the log id. No re-pasting, no inconsistent re-parsing.                                          |
| **Work for internal and external** | The agent's instructions ban Salesforce vocabulary outright. "I saved how you fixed it to the case", never "I updated the resolution field on the Case record".                                                                  |
| **Close the loop across Cases**    | The Related Case Sweep flags other open Cases sharing the root cause, so one diagnosis helps clear a backlog instead of resolving one record.                                                                                    |
| **Full transparency**              | Every write funnels through `Codify_ChangeLogService` and produces an audit row with before/after values and a link back to the source recap.                                                                                    |

## Architecture and data flow

```
Technician in embedded MIAW window on an Experience Cloud Case page
                     │  dictates or types one recap
                     ▼
        Codify_ExtractionService  ── one structured parse ──▶ cached on Codify_Resolution_Log__c
                     │
   ┌─────────────┬───┴─────────┬─────────────────┬──────────────────┐
   ▼             ▼             ▼                 ▼                  ▼
 Log         Tag root      Draft article    Related case      Escalate
 resolution  cause         (DRAFT only)     sweep             for review
 (direct)    (confident    (human review)   (needs confident  (safety valve)
             only)                           cause)
   │             │             │                 │                  │
   └─────────────┴─────────────┴─────────────────┴──────────────────┘
                     │
                     ▼
             Codify_Change_Log__c   ← every action writes exactly one audit row
```

## The five agent topics

| #   | Topic                       | Risk                  | What it does                                                                                                                                                                                     |
| --- | --------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Log Resolution**          | Direct write          | Extracts the resolution summary and root cause, writes both to the Case. Lower risk: it's the record already being closed, not a new customer-facing artifact.                                   |
| 2   | **Tag Root Cause**          | Direct write          | Classifies against the custom-metadata taxonomy. Usually runs inside Log Resolution; called separately when a technician corrects the cause — and a human naming it always beats the classifier. |
| 3   | **Draft Knowledge Article** | **Human review**      | Drafts into the org's template, always in `Draft`. Declines outright when the recap has a cause but no steps, because that makes an article nobody can follow.                                   |
| 4   | **Related Case Sweep**      | Writes to other Cases | Flags other open Cases with the same or a closely related cause. Writes a _suggestion_ field, never their resolution.                                                                            |
| 5   | **Escalate for Review**     | Safety valve          | When confidence is too low, creates a Task for a Knowledge/Support Ops owner carrying the verbatim recap and the candidates it was torn between.                                                 |

## How the classifier decides

Scoring counts **distinct** keyword hits against each active taxonomy row, normalised against a saturation ceiling of three:

| Distinct keywords matched | Score | Result                            |
| ------------------------- | ----- | --------------------------------- |
| 1                         | 0.33  | **Below the 0.34 floor — no tag** |
| 2                         | 0.67  | Tagged                            |
| 3+                        | 1.00  | Tagged                            |

That asymmetry is the entire guardrail. One incidental word cannot tag a Case; corroboration is required. Counting _distinct_ keywords rather than occurrences means repeating one word in a rambling recap can't fake it.

Declining is a **designed outcome, not a failure**. A wrong root cause tag does not just mislabel one record — it misdirects the Related Case Sweep and pushes the wrong fix onto other people's open Cases. That is why the sweep re-checks confidence at the point of blast radius, not just at the point of classification.

## Data model

**`Codify_Resolution_Log__c`** — the raw recap history. Holds the verbatim recap (never rewritten, so a reviewer can always compare a draft against what was actually said), the extracted summary, the root cause and its confidence, whether a draft was produced, and the cached `Extraction_JSON__c` that makes "one recap, many outputs" true in code.

**`Codify_Change_Log__c`** — the audit backbone. One row per action, with `Change_Type__c`, `Related_Record_Id__c`, `Object_API_Name__c`, `Old_Value__c` / `New_Value__c`, `Requires_Human_Review__c`, and a lookup back to the resolution log so every change traces to the exact recap that produced it.

**`Codify_Root_Cause_Taxonomy__mdt`** — the configurable root cause categories, with detection keywords, an article-worthiness flag, and related keys for the sweep. 14 rows ship covering hardware, software, configuration, process, environmental and user-error causes. Retire a cause by unchecking `Is_Active__c` rather than deleting it, so historical tags stay meaningful.

Plus custom fields on **Case** (resolution summary, root cause, suggested fix, resolved-via-Codify) and **Knowledge\_\_kav** (generated flag, article body, original recap, source Case and log).

## The Codify app

A Lightning app for service ops and Knowledge owners, separate from the MIAW window technicians use.

| Tab                         | Backed by                  | Shows                                                                                                         |
| --------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Codify Home**             | `codifyHomeDashboard`      | Resolutions this week, articles drafted vs. awaiting review, related Cases flagged, escalations, 7-day trend. |
| **Change Log**              | `codifyChangeLogConsole`   | Every change, filterable by technician, Case, root cause, type and date, with before/after values.            |
| **Resolution Logs**         | object tab                 | The raw recap history, linked forward to the Case and any article.                                            |
| **Pending Article Reviews** | `codifyArticleReviewPanel` | Drafts side by side with the recap that produced them. Edit or reject; publishing stays in Knowledge.         |
| **Root Cause Trends**       | `codifyRootCauseTrends`    | Which causes recur most, and a **coverage** column flagging recurring causes with no article behind them.     |

`codifyCaseHistoryBadge` sits on the Case record page itself: "Codify logged this resolution and drafted a Knowledge article", expandable, with click-through to the source recap.

**List views:** Knowledge "Codify Drafts Pending Review" · Cases "Resolved via Codify" · Resolution Logs "This Week" and "By Root Cause" · Change Logs "This Week", "Awaiting Human Review", "Field Updates Only".

## Component inventory

**Apex (17 classes)** — `Codify_Constants`, `Codify_Util`, `Codify_ResolutionParse` (DTO), `Codify_ExtractionService` (the only place a recap is interpreted), `Codify_ChangeLogService` (the audit backbone); five invocables (`LogResolution`, `TagRootCause`, `DraftArticle`, `RelatedCaseSweep`, `EscalateForReview`); three LWC controllers; `Codify_TestUtil` and three test classes.

**Flows (6)** — five autolaunched (`Codify_Log_Resolution`, `Codify_Tag_Root_Cause`, `Codify_Draft_Knowledge_Article`, `Codify_Related_Case_Sweep`, `Codify_Escalate_For_Review`), each wrapping one invocable and mapping its outputs for the agent; plus `Codify_Route_To_Agent`, the Omni-Channel routing flow that hands an incoming messaging session to the agent.

**LWCs (5)** — the four in the brief plus `codifyRootCauseTrends`, which backs the required Root Cause Trends tab.

**Agent** — `Codify_Agent`, an `AiAuthoringBundle` of type `AgentforceServiceAgent` with a router and six subagents.

**MIAW** — `Codify_MIAW` messaging channel, `Codify_Embedded` deployment, `Codify_Route_To_Agent` routing flow, `Codify_Support_Ops` queue. No `EmbeddedServiceBranding`: that type is not valid for `EmbeddedMessaging` deployments, so the theming lives in `experience-site/head-markup.html`.

**Permission sets** — `Codify_Agent_User` (the MIAW running user; no delete on audit objects, no Knowledge publish right) and `Codify_Reviewer` (service ops and Knowledge owners; read-only on the change log).

## Guardrails

**Knowledge drafts never auto-publish.** This is enforced _structurally_, not conditionally. `Codify_DraftArticleInvocable` inserts a `Knowledge__kav` — which the platform creates in `Draft` — and never calls `KbManagement.PublishingService` anywhere. There is no flag, no input and no malformed agent response that can publish one, because there is no code path that publishes. The `forceDraft` input skips only the worthiness check, never review. `Codify_ArticleReviewController` deliberately omits a publish action for the same reason: adding one would turn a hard guardrail into a one-click bypass.

**Every write produces an audit row.** Not optional, not configurable.

**Case resolution updates apply directly.** They are internal record-keeping on the record being closed. Confirming every field would defeat the under-a-minute goal.

**Low confidence routes to a human.** Codify says so plainly and creates a Task rather than forcing a guess.

**The sweep only suggests.** It writes `Codify_Suggested_Fix__c` on other Cases and never their resolution fields. Those Cases belong to other people and have not been diagnosed.

## Install and deploy

**Prerequisites:** Salesforce Knowledge enabled with `Knowledge__kav` and the running user flagged as a Knowledge User; Agentforce enabled; Messaging for In-App and Web enabled; an Einstein Agent User for `default_agent_user`.

```bash
git clone <this repo> && cd codify
sf org login web --alias codify-org
```

Deploy in dependency order — `Codify_Resolution_Log__c` must exist before the objects that look up to it:

```bash
sf project deploy start -d force-app/main/default/objects/Codify_Resolution_Log__c -o codify-org
sf project deploy start -d force-app/main/default/objects -d force-app/main/default/customMetadata -o codify-org
sf project deploy start -d force-app/main/default/classes -o codify-org
sf project deploy start -d force-app/main/default/flows -d force-app/main/default/lwc -o codify-org
sf project deploy start -d force-app/main/default/flexipages -o codify-org
sf project deploy start -d force-app/main/default/tabs -d force-app/main/default/applications -o codify-org
sf project deploy start -d force-app/main/default/queues -d force-app/main/default/messagingChannels -o codify-org
sf project deploy start -d force-app/main/default/permissionsets -o codify-org
sf project deploy start -d force-app/main/default/aiAuthoringBundles -o codify-org
```

Then:

```bash
sf org assign permset --name Codify_Agent_User --name Codify_Reviewer -o codify-org
```

Set `default_agent_user` in `Codify_Agent.agent` to a real Einstein Agent User before publishing, then `sf agent publish`. Finally follow the MIAW and Experience Cloud steps in [`experience-site/README.md`](experience-site/README.md) — the embedded deployment needs an ESW site that only Setup can create.

## Configuration reference

**Tuning the taxonomy** — add or edit rows in `force-app/main/default/customMetadata/`. `Detection_Keywords__c` drives classification, `Article_Worthy__c` decides whether that kind of fix is normally worth writing up, `Related_Keys__c` widens the sweep. No Apex change needed.

**Tuning thresholds** — `Codify_Constants`:

| Constant                      | Default | Effect                                                             |
| ----------------------------- | ------- | ------------------------------------------------------------------ |
| `ROOT_CAUSE_CONFIDENCE_FLOOR` | `0.34`  | Below this, no tag. Raising it above 0.67 requires three keywords. |
| `MIN_RECAP_LENGTH`            | `25`    | Shorter recaps are rejected outright.                              |
| `MAX_SWEEP_CASES`             | `25`    | Caps how many Cases one fix can be suggested onto.                 |
| `ESCALATION_DUE_DAYS`         | `2`     | Due date on the escalation Task.                                   |

## Testing

```bash
sf apex run test -o codify-org -l RunLocalTests -w 20
npm run test:unit          # LWC Jest
npm run prettier:verify
npm run lint
```

The suite covers the guardrails hardest: that an uncorroborated keyword does **not** tag, that the sweep refuses to run from a low-confidence diagnosis, that a forced draft still lands in `Draft`, that a second draft run does not duplicate, and that rejecting a draft keeps the resolution. See the note below on environment-dependent results.

## Project structure

```
codify/
├── force-app/main/default/
│   ├── aiAuthoringBundles/Codify_Agent/     # the MIAW service agent
│   ├── classes/                             # 17 Apex classes
│   ├── customMetadata/                      # 14 root cause taxonomy rows
│   ├── EmbeddedServiceConfig/               # the embedded deployment
│   ├── flexipages/ tabs/ applications/      # the Codify app surface
│   ├── flows/                               # 5 autolaunched flows
│   ├── lwc/                                 # 5 components
│   ├── messagingChannels/                   # the MIAW channel
│   ├── objects/                             # 2 custom objects, 1 CMT, Case + Knowledge fields
│   ├── permissionsets/                      # agent user + reviewer
│   └── queues/                              # Support Ops (session handler + human fallback)
└── experience-site/
    ├── head-markup.html                     # dark theme, panels, host bridge
    ├── demo-case-page.html                  # standalone harness
    └── README.md                            # MIAW + Experience Cloud setup
```

## Status and known environment notes

Codify is **deployed, published and running** in `test-81e-dev-ed.develop.my.salesforce.com`:

| Check                 | Result                                                                                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Metadata deploy       | All components clean — 17 Apex classes, 5 flows, 5 LWCs, 56 object components, 14 taxonomy rows, tabs, flexipages, app, both permission sets, messaging channel, queue, embedded deployment |
| Apex tests            | **46/46 pass**, 94% coverage across the Codify classes (85–100% per class)                                                                                                                  |
| Agent                 | `Codify_Agent` compiles, is **published and activated** as a Service Agent (`ExternalCopilot`)                                                                                              |
| Embedded deployment   | `Codify_Embedded` live on the `Codify` Experience site, wired to the `Codify_MIAW` channel                                                                                                  |
| End-to-end smoke test | One recap produced a tagged Case, a Knowledge **Draft**, a suggestion on a sibling Case, and 5 audit rows — one per action                                                                  |

Smoke-test records were removed afterwards, so the org holds the app and taxonomy but no sample data.

### Six bugs only a real deploy would have caught

All fixed here. Each failed with an error that pointed nowhere near its cause, which is the reason they are written down.

1. **Custom metadata needs `xmlns:xsd` declared.** Every value uses `xsi:type="xsd:string"`; with the prefix undeclared the Metadata API rejects the deploy with a bare `UNKNOWN_EXCEPTION` and no component detail. A record with _no_ values validates cleanly, which is what makes it hard to spot. [Scribe](../scribe) has the same latent issue.
2. **Prettier corrupts `<flow>` elements.** `prettier-plugin-xml` hands their content to its JavaScript-Flow parser, which appends a stray `;` and reflows the value — silently breaking `flowAccesses`. `**/permissionsets/**` is excluded in `.prettierignore` and those files are formatted by hand.
3. **Agent Script needs a full locale.** `default_locale: "en"` is rejected by the compiler with a 422 that names no line or field; it must be `"en_US"`. Scribe carries the same value, which is why its bundle fails to compile too.
4. **Agent action outputs must match their Flow variable names exactly.** A Flow variable cannot be both an input and an output, so `Codify_Draft_Knowledge_Article` renames its output to `draftedArticleTitle` — and the agent must declare that name, not `articleTitle`. The mismatch only surfaces on save, as a Generative AI Function Definition error.
5. **A messaging channel with a Queue session handler never reaches the agent.** The window opens, the message shows "Sent", and nothing answers, because queue routing waits for a _human_ to accept the work. Handing a session to an Agentforce agent requires a `RoutingFlow` calling `routeWork` with `routingType: Bot` — `Codify_Route_To_Agent`. The queue remains only as `routeWork`'s fallback.
6. **The Experience Cloud head markup has to be scoped to the messaging widget.** It runs in the `<head>` of the whole site, so a stylesheet containing `html, body` and `p, span, div` — perfectly safe inside a shadow root, which is self-scoping — repaints the entire portal when injected at page level. The page-level rules are now prefixed with the widget root, and the shadow walk starts from the widget rather than `document`.

### The one thing that cannot come from source

An embedded messaging deployment must point `<site>` at a **dedicated ESW site**, and only the Setup wizard mints one. The Tooling API refuses to create a deployment without it (`REQUIRED_FIELD_MISSING: SiteId`) and will not generate it.

Pointing `<site>` at an ordinary Experience site deploys cleanly and then fails silently — which is exactly what happened here. The deployment can never be published, so its config endpoint stays on `HTTP 412 "Embedded Messaging Config is not Published"`, no chat button renders (the bootstrap fetches that config before drawing anything), and Setup refuses to change the CWC version. Publishing the Experience _site_ is a different operation and does not help.

`<site>` is therefore an explicit placeholder. Create the deployment in Setup, publish it, then copy the generated `ESW_…` name into the file. The [`experience-site/README.md`](experience-site/README.md) has the steps and the `curl` check that distinguishes published from not — it also explains why the deployment deliberately has no pre-chat form and no `EmbeddedServiceBranding`.

## License

See [LICENSE](LICENSE).
