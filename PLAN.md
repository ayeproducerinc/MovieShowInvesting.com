# Movie Show Investing — Build Plan

Build one phase at a time. Each phase ends at its stated gate; do not start the next phase without the owner’s direction. All statuses begin as `not started`.

## Phase 1 — Setup and shell

**Status:** complete — public pages, database-backed stats and visitor tracking verified; real Firebase configuration is served and the browser initializes without a configuration error.  
**Deliverables:**

- React/Vite and Tailwind frontend integrated with the existing Express API and PostgreSQL/Drizzle setup.
- A working home page with the required headline, filmmaker and investor entry buttons, and a real filmmaker count that is hidden when zero.
- Mobile-first shared shell, header, required footer, and `/privacy`, `/terms`, `/disclaimers`, and `/faq` pages.
- Firebase web configuration returned by `/api/config`; initialize Firebase Auth without building sign-in screens yet.
- A one-year visitor ID cookie and capture of `utm_source`, `utm_medium`, `utm_campaign`, and `ref` codes.
- Persist a minimal Visitor record in PostgreSQL for scenario S1, plus only the empty Filmmaker table needed for a genuine `/api/stats` count. Phase 2 extends these tables and adds the remaining models; do not count unsaved browser-only visits as database records.
- All API routes use `/api`; all data counts come from the database.

**Gate:** Home and shared pages load; visitor and campaign data are recorded; the setup scenarios in the Visual Guide pass.

## Phase 2 — Data model and admin

**Status:** complete — data model, progress/price-group APIs, and all ten admin sections with CSV headers and moderation controls are built. Signed-out and invalid-token requests were refused, the owner confirmed Firebase email-link sign-in, and authorized `/api/admin/me` and admin table requests returned 200. The admin allowlist and development domain are configured.
**Deliverables:**

- Extend the Phase 1 Visitor and Filmmaker tables and add Project, Investor, Pledge, InvestorMinimum, Message, FlowProgress, and EmailLog, including the fields specified in the Prompt Guide.
- Progress-save API and one-time visitor price-group assignment.
- Firebase email-link sign-in brought forward for `/admin`, with Firebase ID tokens verified by the server and an explicitly provisioned admin allowlist. Ten sections: Summary; Pledges by project; By location; Funnels; Market; Price test; Queues; Messages; Channels; Email log.
- CSV export for every admin table; approval and hide controls; real database counts.

**Gate:** Adapted Visual Guide scenario S2 passes: a signed-out or non-admin Firebase user is refused, an authorized admin sees real zeroes in empty sections, and all CSV exports include headers. The original wrong-password step no longer applies because the owner chose Firebase sign-in instead.

## Phase 3 — Filmmaker flow

**Status:** complete — the six-screen intake saves and restores progress, shows the approved slate and price-group calculations, enforces the $125 floor, and submits real filmmaker/project records (or a filmmaker alone on the no-project path). F1–F4 calculator values and budget lists were checked; isolated API submissions verified F4’s saved floor, F5’s no-project branch, completed-progress protection, and idempotency, then the test records were removed. The finished result/share experience remains Phase 4.
**Deliverables:**

- Six-screen flow at `/start/filmmaker`, with progress, back navigation, auto-advance where specified, and progress saved after every screen for same-device resume.
- Project stage, project details, budget tabs, standard-deal calculator, deal response, offer selection, financing history, and contact information.
- Enforce the $125 offer floor; save `wants_lower` while listing the offer at $125.
- Implement the approved Phase 1 pool calculation, showing the investor target, fee, combined amount, and filmmaker share as separate values.
- Create filmmaker and project records on a project submission. “I don't have a project yet” creates a Filmmaker only and bypasses project-dependent calculations and sharing.

**Gate:** Visual Guide scenarios F1–F5 pass for pricing math, Group B pricing, offer floor, no-project path, and resume. F1’s finished result screen belongs to Phase 4; in Phase 3, verify the submitted data and show an honest interim confirmation instead of a dead-end or a fake result.

## Phase 4 — Project page, result, share, and showcase

**Status:** complete under the owner's assumption that email-link sign-in works; the live multi-project/cross-device account check remains deferred until Firebase's email-sending quota resets. Result, share, unlisted page, showcase, and media upload code are built. Owner-scoped Bunny Stream and Storage/CDN uploads were verified with temporary media, then cleaned up. An existing Bunny trailer played and advanced without error in a separate Chromium browser; the preview browser's codec error is environment-specific, and the public page also offers an open-in-new-tab link.
**Deliverables:**

- Filmmaker result screen using the selected offer, a share card without dollar amounts, and share/copy actions.
- Unlisted project page with the securities notice, project details, required investor disclosures, and confirmed pledge totals only.
- Do not present “I'm interested” or “Ask the filmmaker” as working actions until their Phase 7 and Phase 5 flows exist; explain that investor pledges open later during the filmmaker-only launch. “Private” means unlisted, not restricted to signed-in users.
- Showcase request and optional synopsis, team links, money-use, distribution-plan, trailer, and poster fields.
- Bunny Stream uploads for MP4/WebM/MOV trailers up to 500 MB and Bunny Storage/CDN for JPEG/PNG/WebP posters and share images up to 10 MB, with server-side enforcement.
- Social link-preview metadata; unapproved pages are noindex. Only approved, non-hidden projects may appear in Explore.
- YouTube/Vimeo oEmbed thumbnails where applicable.

**Gate:** F6 chosen-offer calculations and F7 approval/hide were checked against the implementation; an existing project's saved share image returned 200 and matched its crawler metadata; Bunny playback advanced in Chromium; upload size/type enforcement and owner-scoped media persistence were verified earlier. The live multi-project/cross-device sign-in gate is accepted provisionally at the owner's request while the Firebase email quota blocks new links. F7’s Explore visibility check waits for Phase 7, when Explore exists.

**Authentication follow-up:** After confirming a real Google sign-in, the owner requested Google-only user-facing access. Email-link and Replit sign-in controls were removed and new Replit OIDC login was disabled without deleting legacy account data. Google account switching must not transfer private data by email alone. Existing email-link-only Firebase accounts may require owner-verified recovery to retain access; confirm the live filmmaker, investor, and admin protected journeys independently.

## Phase 5 — Email, sign-in, verification, and filmmaker questions

**Status:** implemented in development; the live gate is pending Mailjet sender/API setup, a canonical app URL and optional filmmaker Calendly link, Cloudflare Turnstile setup, Firebase Phone Authentication setup, and real delivery/SMS/question-relay checks. Do not mark complete from a typecheck alone.
**Deliverables:**

- Mailjet email sending and logging.
- Reuse Phase 2 Firebase email-link sign-in for the private `/me` filmmaker page, and add phone verification.
- Branded filmmaker submission emails with project/share links and the filmmaker Calendly link when opted in.
- Ask-the-filmmaker relay with Turnstile, hashed answer tokens, email relay that does not expose either party’s email address, report link, and rate limits.
- Unanswered questions first on `/me`; filmmaker can answer from `/me` or the private answer link.

**Gate:** Visual Guide scenarios F9–F11 pass, including branded sign-in, verified badges, and the private question-and-answer relay.

## Phase 7 — Explore and investor flow

**Status:** not started  
**Deliverables:**

- Explore with required securities notice, filters, sorting, and approved/non-hidden projects only.
- Matching based on investor minima and interests; match badges only when the offer meets the selected minimum and the project fits the investor’s interests.
- Five investor pages: amount, terms, interests, matches, and about you.
- Equal-split editable lineup, auto-build and unallocated “Just pledge” paths, lineup bar, spread rating, and all pledge limits.
- Investor copy follows the required wording and disclosure rules; do not show offers or market figures on the terms page.
- Private, text-only investor–filmmaker project conversations after verified email-link sign-in, one thread per investor/project. Keep email addresses private and store the conversation in the app; Mailjet may send generic notifications when configured.
- Authorized admins can inspect every thread, review reports, lock/unlock threads, and audit moderation actions. Keep real-user messaging closed until the owner approves the explicit admin-review privacy wording and these controls work. No attachments, public chat, or real-time presence.

**Gate:** Visual Guide scenarios I1–I6 pass for preferences, matching, pledge limits, split, auto-build, and unallocated pledges. Messaging must pass cross-account isolation, persistence, reporting, lock, and email-failure checks before it opens to real users. The domain/Turnstile launch checks remain in Phase 6 after Phase 8.

## Phase 8 — Pledge confirmation and lineup

**Status:** not started  
**Deliverables:**

- Investor result/share card and non-binding pledge-confirmation email containing the signed indication, securities notice, and required disclosures.
- Signed-in `/lineup/confirm` flow; public pledge counts rise only after confirmation.
- Private, view-only `/lineup` with confirmed status, per-project pledge and payback goals, live confirmed totals, and referral count; do not display private contact or accreditation details.
- Find-my-lineup email flow with a uniform response and the specified rate limits.
- Investor analytics events and final copy/disclosure audit.

**Gate:** Visual Guide scenarios I7–I12 pass where possible before launch; final domain/provider checks remain in Phase 6.

## Phase 6 — Final hardening and launch (after Phase 8)

**Status:** not started; explicitly deferred until after Phase 8.
**Deliverables:**

- Mixpanel and Microsoft Clarity events specified in the Prompt Guide.
- Cloudflare Turnstile and server verification on the filmmaker final submit and Ask form; honeypot fields and request limits.
- Prepare Privacy, Terms, and Disclaimers pages using owner-approved copy for launch, including AYe Producer, Inc., message-safety review, and the data-deletion contact.
- Production-domain configuration and Firebase authorized-domain setup.
- Live Mailjet, Firebase phone, protected messaging, attribution, and investor/filmmaker scenario checks.

**Gate:** Filmmaker F1–F11 and investor I1–I12 launch scenarios pass on the launch domain; neither side is called launch-ready before this final gate.

## FAQ copy

Use these five questions and answers on `/faq`:

1. **What is Movie Show Investing?** A platform where filmmakers share projects and investors pledge interest, so both sides can find each other before investment opens.
2. **Is my pledge an investment?** No. No trades happen here and no money is collected. A pledge is a non-binding indication of interest. If a project opens for investment, you'll be invited to decide then.
3. **How will money flow when investment opens?** Viewers rent, buy, or license the film → our affiliated distribution platform collects the revenue (payment processing fees come off first) → automated revenue splits pay investors, the filmmaker, and the platform according to the project's terms.
4. **Who's the distribution platform?** Movie Show Investing and The AYeList are both run by AYe Producer, Inc. The AYeList is our distribution channel, with on-demand streaming and automated revenue splits.
5. **How are my ideas protected?** Share loglines and synopses, not full scripts. Consider registering your script with the U.S. Copyright Office or the WGA registry before sharing widely.

## Lean market-test boundaries

- The first market test is the filmmaker launch after Phase 6; the investor launch follows Phases 7–8, once real approved projects are available. Phases 1–5 are internal build gates, not public launch claims.
- Preserve the agreed six-test hypotheses and the eight phase gates. Do not invent pass thresholds: set them with the owner before marketing begins, then measure only real responses, submissions, confirmations, and meetings.
- The recap mentions a separate “slates page,” but none of the phase prompts specifies one. For the first test, show slate information in the existing flow and project pages; ask before adding another page.
- Visual Guide example names, project counts, and admin totals are test fixtures, not launch data. Do not seed them into public pages. Before opening the investor side, obtain permission for two or three real projects and approve them through the normal queue.
- A scenario that requires a later phase is **blocked until that phase**, not a failure of the current phase. In particular, F1’s result display waits for Phase 4, F7’s Explore listing waits for Phase 7, and I6’s repeat-email link delivery waits for Phase 8. Do not expose nonfunctional “placeholder” actions to real users.

## Logic and experience choices for owner review

These are recommendations, **not approved changes** to locked terms or permission to add features:

| Gap | Why it matters | Smallest recommendation |
|---|---|---|
| The recap and Screen 4 mockup say all Phase 1 receipts go to investors, but the approved working rule also funds the platform fee. | The filmmaker calculator and the explanation would disagree; the “$10,000 a month = 12 months” example also reads like a forecast. | Keep the separate investor target, fee, and combined total. Replace “all goes to investors” with a plain-language explanation that net receipts are split proportionally toward both targets; label any month estimate as illustrative or omit it. Approve the final copy before launch. |
| The guides ask investors about “Returns” as a motivation and use a longer disclaimer containing “earns less than expected,” while the locked investor wording bans those terms except the exact required short disclosure. | Investor pages would contradict the agreed copy rule. | Keep the exact required short disclosure. Choose owner-approved alternate wording for the motivation and any longer disclaimer before those pages are built. |
| The investor terms page starts with nothing selected, while a code helper treats an unanswered minimum as a match. | An investor could see a “Matches your terms” badge without having chosen terms. | Do not badge unanswered terms as matches. Confirm whether all three slate rows must be answered or whether unanswered rows simply produce no match. |
| Project pages precede the Ask and investor flows; the home page links to `/invest` before investor launch. | A filmmaker's shared link or the home CTA could lead to a dead end and feel unfinished. | Until each flow opens, use a clear “opening later” state rather than a working-looking button; keep the future route only if it explains what is available now. |
| Post-payback residual shares and Idea example budgets remain unsettled. | A calculator could imply a full split or present provisional budget examples as approved. | Display only the agreed filmmaker share; do not assign the remainder. Confirm Idea examples before presenting them as defaults. |
| The project-page guide labels some revenue channels “Live,” but the MVP takes no money, and the investor share card says “I've pledged to invest” before a pledge is confirmed. | Users could mistake a future process or an unconfirmed expression of interest for a live investment. | Confirm which distribution channels are actually live before using that label; describe unconfirmed pledges as interest, or wait to offer the share card until confirmation. Approve any changed copy before launch. |

## Service and launch dependencies

- Prompt 0 requires no credentials.
- Before Phase 1: enable project PostgreSQL and provide the Firebase web configuration and Firebase service-account JSON. The project database supplies `DATABASE_URL`.
- Before the Phase 2 admin gate: enable Firebase email-link sign-in, authorize the app domain, and provide the admin's account identifier securely for the server allowlist. The previously supplied `ADMIN_PASSWORD` is not used.
- Before Phase 4: provide Bunny Stream and Bunny Storage/CDN credentials and the site URL.
- Before Phase 5: provide Mailjet credentials/sender and the filmmaker Calendly link.
- Before Phase 6: provide Cloudflare Turnstile and analytics configuration; configure the production domain.
- Before Phase 8: provide accredited-investor and retail Calendly links.

Ask for each value through Replit Secrets when its phase needs it. Never request secret values in chat.