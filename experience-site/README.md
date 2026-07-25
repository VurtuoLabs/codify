# Codify — Experience Cloud & MIAW surface

This folder holds the front-end half of Codify's delivery surface: the styling and
host-page wiring that turn a stock embedded messaging window into the Codify
experience a technician sees.

| File                  | What it is                                                                                                                       |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `head-markup.html`    | Paste into Experience Builder → Settings → Advanced → **Edit Head Markup**. Dark theme, welcome and starter panels, host bridge. |
| `demo-case-page.html` | Standalone harness. Open it in a browser to see the host-page side of the contract without an org.                               |

The platform-side metadata lives in `force-app/main/default/`:

- `messagingChannels/Codify_MIAW.messagingChannel-meta.xml` — the MIAW channel
- `flows/Codify_Route_To_Agent.flow-meta.xml` — the Omni-Channel routing flow that puts the agent in the conversation
- `EmbeddedServiceConfig/Codify_Embedded.EmbeddedServiceConfig-meta.xml` — the deployment
- `queues/Codify_Support_Ops.queue-meta.xml` — the session handler and human fallback

## Setup order

The `<site>` on the deployment is **org-specific**: a CustomSite can back exactly
one embedded deployment, so the value in source will not match a fresh org.
Everything else deploys as-is.

1. Deploy the queue, the routing flow, then the channel (the channel references
   the flow, so the flow must exist first):
   ```
   sf project deploy start -d force-app/main/default/queues -o <org>
   sf project deploy start -d force-app/main/default/flows/Codify_Route_To_Agent.flow-meta.xml -o <org>
   sf project deploy start -d force-app/main/default/messagingChannels -o <org>
   ```
   `routeWork` takes literal record ids, so re-point the three ids in the routing
   flow first:
   ```
   sf data query -o <org> -q "SELECT Id FROM BotDefinition WHERE DeveloperName='Codify_Agent'"
   sf data query -o <org> -q "SELECT Id FROM Group WHERE DeveloperName='Codify_Support_Ops' AND Type='Queue'"
   sf data query -o <org> -q "SELECT Id FROM ServiceChannel WHERE DeveloperName='sfdc_livemessage'"
   ```
2. Point `<site>` in `Codify_Embedded.EmbeddedServiceConfig-meta.xml` at a
   CustomSite in the target org that no other deployment is using. Creating the
   deployment once in Setup → **Embedded Service Deployments** also mints a
   dedicated `ESW_…` site you can use instead.
3. Deploy the config:
   ```
   sf project deploy start -d force-app/main/default/EmbeddedServiceConfig -o <org>
   ```
4. Publish and activate the agent:
   ```
   sf agent publish authoring-bundle --api-name Codify_Agent -o <org>
   sf agent activate --api-name Codify_Agent -o <org>
   ```
5. Paste `head-markup.html` into the Experience Cloud site's head markup.
6. Add the Embedded Messaging component to the Case detail page, and wire the host
   page to post `CODIFY_SET_CASE` — see the contract below.

### The agent has to be routed to, or it never joins

The single most confusing failure in this stack: the window opens, the technician
types, the message shows **Sent**, and nothing ever answers.

A messaging session is Omni-Channel work, and it has to be routed somewhere. A
`sessionHandlerType` of `Queue` routes it to _people_ — so the session sits
waiting for a human to accept it, and since there is no human behind Codify, it
waits forever. The only way to hand a session to an Agentforce agent is a
`RoutingFlow` that calls `routeWork` with `routingType: Bot` and the agent's
`botId`. That is what `Codify_Route_To_Agent` does, and the channel points at it
with `sessionHandlerType: Flow`.

The queue is still configured, as the fallback `routeWork` uses if the agent
cannot take the work. It is the fallback, not the destination.

Also check the agent is actually live, since publishing alone is not enough:

```
sf data query -o <org> -q "SELECT BotDefinitionId, VersionNumber, Status FROM BotVersion"
```

### Two things that are not configurable, and why

**The deployment carries no pre-chat form.** Salesforce rejects an embedded
messaging deployment whose standard messaging parameters are marked hidden
(_"Form field of type StandardMessagingChannelParameter can't be a hidden
field"_), and a _visible_ pre-chat form asking a technician to key a Case number
would reintroduce exactly the friction Codify exists to remove. So the deployment
has no form at all, and `head-markup.html` pushes the Case in at runtime through
`embeddedservice_bootstrap.prechatAPI.setHiddenPrechatFields()` instead. That is
the supported route for programmatic context.

**There is no `EmbeddedServiceBranding` file.** That metadata type only applies to
Chat, Flow and Appointment Management deployments; applying it to an
`EmbeddedMessaging` deployment fails with _"Set the Chat, Flow, or Appointment
Management feature…"_. MIAW theming therefore lives entirely in
`head-markup.html` plus the deployment's own settings in Setup.

## Two things that must be done in Setup

Neither is reachable from the Metadata API, and both were verified against this
org rather than assumed.

### 1. The deployment has to be published, or no widget appears at all

If nothing shows in the bottom corner, check this first — it is not a styling or
placement problem. Ask the config endpoint directly:

```
curl "https://<myDomain>.my.salesforce-scrt.com/embeddedservice/v1/embedded-service-config?orgId=<orgId>&esConfigName=Codify_Embedded&language=en_US"
```

- `HTTP 412 {"text":"Embedded Messaging Config is not Published"}` — the
  deployment exists but has never been published. **Setup → Embedded Service
  Deployments → Codify → Publish.**
- `HTTP 200` with a JSON body — published, and the widget should render.

A working deployment's response also shows `siteUrl` pointing at its own
dedicated `ESW_…` site. `Codify_Embedded` currently points at an ordinary
Experience site because a fresh ESW site cannot be minted from source, so if
publishing does not resolve it, recreate the deployment through the Setup wizard
and let it mint its own site.

### 2. The script has to be pasted into Edit Head Markup

`head-markup.html` cannot be deployed through the site bundle. The per-view
`customHeadTags` attribute on `community_builder:seoAssistant` is the only head
field the bundle exposes, and it is `link`/`meta` only in practice — tested
against this org:

| Value                                  | Result   |
| -------------------------------------- | -------- |
| `<link rel="stylesheet" href="…">`     | deploys  |
| `<script>…inline…</script>`            | rejected |
| `<script src="/sfsites/c/resource/…">` | rejected |

Both script forms fail with _"The customHeadTags field can only contain link,
meta, script tags, and valid tag attributes"_ despite the message naming script
tags, which points at the site's CSP posture rather than the field itself.

So the script goes where it always did: **Experience Builder → Settings →
Advanced → Edit Head Markup**. That field accepts inline script and is not
represented in `DigitalExperienceBundle`, so it stays a manual step.

## The host-page contract

Codify's window and the page hosting it talk over `postMessage`. This is what
delivers pre-chat Case context, so a technician who opened Codify from a Case is
never asked which Case they are closing.

**Host page → Codify window**

| Message               | Payload                               | When                                         |
| --------------------- | ------------------------------------- | -------------------------------------------- |
| `CODIFY_SET_CASE`     | `caseId`, `caseNumber`, `caseSubject` | Before opening. Always send this first.      |
| `CODIFY_SHOW_WELCOME` | —                                     | To open on the welcome panel.                |
| `CODIFY_SHOW_STARTER` | —                                     | To skip straight to the recap prompts.       |
| `CODIFY_INPUT_ON`     | —                                     | When the agent has joined and input is live. |
| `CODIFY_MINIMIZE`     | —                                     | To close the window and clear any panel.     |

**Codify window → host page**

| Message           | Payload | Meaning                                          |
| ----------------- | ------- | ------------------------------------------------ |
| `CODIFY_READY`    | —       | The window is listening for context.             |
| `CODIFY_FAB_SIZE` | `width` | Launcher width, so the host can size its iframe. |

Order matters: send `CODIFY_SET_CASE` **before** `CODIFY_SHOW_WELCOME`. Sending
them the other way round is the bug that makes the agent open by asking which
Case it is, which is the exact friction the pre-chat context exists to remove.

`CODIFY_INPUT_ON` matters for a subtler reason. A technician who taps a starter
prompt in the first couple of seconds would otherwise have it fired into a window
that is not yet listening, and it would vanish with no feedback. The window holds
that utterance and releases it when `INPUT_ON` arrives.

## Theming, and where this file goes

`head-markup.html` styles the widget's interior by injecting an adopted
stylesheet into each of its nested shadow roots, which a page-level stylesheet
cannot reach.

**The same file behaves differently depending on which head markup you paste it
into, and it detects which.** This is the thing that bit us:

| Pasted into                             | What the document is | What the script does                                              |
| --------------------------------------- | -------------------- | ----------------------------------------------------------------- |
| The **ESW site** serving the chat frame | The agent UI itself  | Applies the full stylesheet globally — `html, body` _is_ the chat |
| The **host Experience site**            | Your portal page     | Confines everything to the embedded messaging component           |

The original VenueNation version was written for the first case, which is why it
styles `html, body` and `p, span, div` unconditionally and calls
`window.parent.postMessage`: it runs inside the chat frame. Dropped into a portal
page unchanged, those same rules repaint the entire site.

`isAgentDocument()` decides which context it is in, and `styleRoots()` returns
either `[document]` or just the widget. On this org the embedded deployment's
`<site>` is the Codify Experience site itself, so the markup runs in _both_
places — the portal page and the chat frame — and the detection is what keeps the
portal intact while still theming the conversation.

If Salesforce changes the widget's markup, add the new container selector to
`ROOT_SELECTORS` rather than widening any CSS selector.

## Why it looks different from the VenueNation concierge

Same architecture, different job, so a few choices diverge on purpose:

- **Salesforce-family blue on near-black**, not crimson on black. This is an
  internal service tool inside a portal, not consumer brand furniture.
- **Inter in sentence case**, not Oswald in uppercase. Technicians are dictating a
  paragraph of detail; display type built for a hero banner fights that content.
- **Starter prompts are example recaps, not questions.** Codify needs the
  technician to talk first, so the panel shows the shape of a useful answer rather
  than a menu of things to ask.
- **Context is a Case, not a venue.** That is what makes the launch-from-a-record
  flow work.
