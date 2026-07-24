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
- `EmbeddedServiceConfig/Codify_Embedded.EmbeddedServiceConfig-meta.xml` — the deployment
- `EmbeddedServiceBranding/Codify_Branding.EmbeddedServiceBranding-meta.xml` — platform chrome colours
- `queues/Codify_Support_Ops.queue-meta.xml` — the session handler and human fallback

## Setup order

MIAW deployments cannot be created purely from source, because every embedded
deployment needs its own **ESW site** and Salesforce mints those only when you
create the deployment in Setup. A site can back exactly one deployment, so it
cannot be shared or invented.

1. Deploy the queue and channel:
   ```
   sf project deploy start -d force-app/main/default/queues -o <org>
   sf project deploy start -d force-app/main/default/messagingChannels -o <org>
   ```
2. In Setup → **Embedded Service Deployments** → New → Messaging for In-App and Web,
   point it at the **Codify** messaging channel. This creates the `ESW_…` site.
3. Copy that site's name into `<site>` in `Codify_Embedded.EmbeddedServiceConfig-meta.xml`,
   replacing `ESW_Codify_Placeholder`.
4. Deploy the config, then the branding (in that order — the two reference each
   other, so branding cannot land until the config exists):
   ```
   sf project deploy start -d force-app/main/default/EmbeddedServiceConfig -o <org>
   sf project deploy start -d force-app/main/default/EmbeddedServiceBranding -o <org>
   ```
5. Paste `head-markup.html` into the Experience Cloud site's head markup.
6. Add the Embedded Messaging component to the Case detail page, and wire the host
   page to post `CODIFY_SET_CASE` — see the contract below.

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

## Theming

`head-markup.html` restyles what lives _inside_ the messaging window's nested
shadow roots, which a page-level stylesheet cannot reach; it walks every shadow
root and injects an adopted stylesheet. `EmbeddedServiceBranding` controls the
chrome the platform draws _around_ it.

The two are kept in step by hand. If you change `BRAND.accent` in the head markup,
change `primaryColor` in the branding file to match, or the launcher and the
conversation will visibly disagree.

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
