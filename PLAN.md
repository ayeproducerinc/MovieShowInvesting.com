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
- Do not present “I'm interested” or “Ask the filmmaker” as working actions until their Phase 7 and Phase 5 flows exist; explain that investor pledges open later during the filmmaker-only launch. “Private” means unlisted, not restricted to signed-in users. *(No longer applies: pledging is open from day one; see DECISIONS.md and Phase 9.3.)*
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

**Status:** implemented in development; gate pending. The investor minimum, matching, split, cap, mixed-slate auto-build, and unallocated paths have been checked in code and calculation tests. Development now has two approved available projects and a saved two-project intent, but the full I1–I6 real-user scenarios, including the multi-project I4/I5 checks, have not been marked passed; do not create disposable projects to simulate them. With three existing accounts, a nonparticipant did not see the private conversation and the conversation-list API denied access; two participant messages persisted despite email notifications being unconfigured. Report, review, lock, unlock, and resolution were recorded and the thread is open again. Code now allows verified investors to start conversations with approved filmmakers across different sign-in providers and allows dual-role accounts to message other filmmakers; cross-provider and dual-role live checks remain pending. Conversation caches and drafts are scoped by provider and account, but a live account-switch isolation check is still required. Direct nonparticipant thread access and configured-provider email failure remain unverified. The messaging notice was approved by the owner and is displayed in the project conversation flow and Privacy page. Messaging remains available at the owner's request; availability alone is not a gate result.
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

**Status:** partly implemented in development. The private `/lineup` page shows saved or confirmed non-binding interest and project allocations. Signed-in investors can review and sign the exact saved choices at `/lineup/confirm`, and original-browser guests can explicitly claim matching-email interest after sign-in. Eligible public project totals count confirmed allocations only; hidden or unapproved projects do not display public totals. A private signed-interest result/share card and lineup figures based on real confirmed totals and the project's current payback offer are built. Investor copy was audited against the required securities and risk notices. The owner confirmed referral count is out of this MVP rather than counting visits as investors. The supplied Mixpanel project token is configured for development only; named investor events are wired, signed-in Mixpanel profiles use opaque IDs, and session replay requires visitor opt-in on Home, Explore, or FAQ with private routes excluded. Broad autocapture stays off. The user's screenshot showed Mixpanel detecting Events, but Users and Replays have not yet been verified in Mixpanel after real sign-in/opt-in; production analytics and Microsoft Clarity remain unconfigured. The owner confirmed a signed-in investor could save a separate fresh interest under an email also used by an unclaimed guest; duplicate account or visitor records now fail explicitly instead of reading or signing an arbitrary record, but revision/confirmation and downstream totals still require genuine verification. The authenticated filmmaker flow check remains open. The owner has deferred investor confirmation email for now, and email-dependent lineup recovery remains pending until email setup is revisited.
**Deliverables:**

- Investor result/share card and non-binding pledge-confirmation email containing the signed indication, securities notice, and required disclosures.
- Signed-in `/lineup/confirm` flow; public pledge counts rise only after confirmation.
- Private, view-only `/lineup` with confirmed status, per-project pledge and payback goals, live confirmed totals, and referral count; do not display private contact or accreditation details.
- Find-my-lineup email flow with a uniform response and the specified rate limits.
- Investor analytics events and final copy/disclosure audit.
- End-to-end filmmaker flow check in development: sign-in and original-browser guest claim, starting and resuming a worksheet, submitting a project, managing and reopening it from My projects, public showcase eligibility, and the in-app alert after a genuine confirmed interest action. Do not fabricate confirmations or claim provider-dependent or production-domain checks passed when they cannot run.

**Gate:** Visual Guide scenarios I7–I12 and the end-to-end filmmaker path pass where possible before launch; final domain/provider rechecks remain in Phase 6.

**Workflow clarity update:** The filmmaker budget/payback screens now distinguish example budgets from entered estimates, collect the standard price-test reaction before offer customization, and show the investor target, separate fee, combined threshold, and filmmaker's after-payback share without a time-to-payback forecast. Funding questions skip history that does not exist. The submission result and project share card distinguish unlisted link access, explicit showcase-review requests, and listing approval; edits to approved showcase content can send the project back for review. The investor interest, signature, lineup, and public-link share copy clarify non-binding status and private-record boundaries. These are development changes, not a passed end-to-end or launch gate: real protected submission, provider delivery, account switching, and launch-domain checks remain outstanding.

## Phase 6 — Final hardening and launch (after Phase 8)

**Status:** partly implemented in development: the filmmaker final-submission form has a bot-trap field and a real, action-scoped Turnstile widget; the API verifies its token against server-configured hostnames before creating a submission and applies database-backed, hashed per-network and per-visitor attempt limits. The Ask form also requires an action- and hostname-checked Turnstile response and rejects a filled bot-trap field. Both forms fail closed without configured Turnstile keys and a permitted hostname. The development rate-limit table exists; the filled filmmaker bot-trap rejection was checked, but genuine protected submissions, delivery, and full rate-limit boundaries have not been exercised. Firebase admin access now checks the canonical Firebase UID as well as the verified email; its live admin-account path remains unverified. Clarity code is opt-in and restricted to public Home, Explore, and FAQ, with private navigation forcing a reload before rendering; adding its production project ID, genuine replay verification, and owner approval of updated privacy wording remain pending. Launch legal review, production-domain setup, provider checks, and live scenarios remain pending; this phase is not launch-ready.

The owner supplied `support@ayeproducer.com` as the data-deletion contact. The privacy draft now displays that contact, but the remaining legal wording is not owner-approved for launch. The owner has no domain yet, so real Turnstile setup and launch-domain checks remain blocked; do not enable the protected forms without those checks or call this phase complete.
**Deliverables:**

- Mixpanel and Microsoft Clarity events specified in the Prompt Guide.
- Cloudflare Turnstile and server verification on the filmmaker final submit and Ask form; honeypot fields and request limits.
- Prepare Privacy, Terms, and Disclaimers pages using owner-approved copy for launch, including AYe Producer, Inc., message-safety review, and the data-deletion contact.
- Production-domain configuration and Firebase authorized-domain setup.
- Live Mailjet, Firebase phone, protected messaging, attribution, and investor/filmmaker scenario checks.

**Gate:** Filmmaker F1–F11 and investor I1–I12 launch scenarios pass on the launch domain; neither side is called launch-ready before this final gate.

## Phase 9 — Pledge-first growth features

**Status:** not started. Rules are in DECISIONS.md (Product and scope, Backer names, Investor pledge limits, Project updates, Money date, Admin follow-up and research). The owner's brief numbers its own phases 0–10; to avoid clashing with Phases 1–8 above, each step keeps the brief's number with “9.” in front (9.4 is the brief's Phase 4). Phase 0 (report of what exists) and 9.1 (these decisions) are written. Work one step at a time; stop at each gate, report “ready for testing” with raw evidence (test output, `git show --stat`, grep results), and wait for the owner to continue. Never run anything against a real database: write the migration and the exact command for the owner to run. No new servers, scheduler, or sign-in. Mobile first; text wraps and nothing overflows.

**Steps and gates:**

- **9.2 Pledge minimum and two ways in — ready for testing (2026-10-09).** Built: shared $100-per-project / 5-project rule in server, worksheet and API spec (server tests 45/45, frontend lineup tests 6/6, typecheck clean); project-page links open the owner-approved two-screen pledge (`/invest?project=<slug>&one=1`). Pending: Replit codegen for the React client comments, and a signed-in browser check of both paths. $100 per project everywhere, up to 5 projects; signed pledges unchanged; database check left alone with $100 enforced in the application. One-project path from a project page and multi-project path from Explore, both with age acknowledgment, sign-in, and the single review-sign-confirm step. *Gate:* the exact one-project steps are listed and approved by the owner before that path is built; then frontend, server and API reject new per-project amounts under $100 and more than 5 projects, and existing signed pledges read back unchanged.
- **9.3 Open pledging — not started (partly in place).** No investor launch gate exists in code today, but the server accepts pledges only for approved, showcase-requested projects and the submission page still says pledges open later. *Gate:* a submitted, non-hidden project page accepts pledges whether or not approved; Explore lists approved projects only; public counts stay confirmed-only on approved projects; pledging succeeds with email unconfigured and logs `unconfigured`.
- **9.4 Backer names — not started.** Signing-step notice and off-by-default public-display checkbox per DECISIONS.md › Backer names; notice version and choice stored per signed entry. *Gate:* filmmaker and admin see name, email and amount; pre-notice pledges show “Backer (name not shared)” with no email; names appear publicly only with the opt-in on approved projects.
- **9.5 Project updates data and API — not started.** Updates table and update-emails table (unique per update and backer, `interest_alerts` status pattern); filmmaker create/list, admin list/approve/reject, public approved-only read. *Gate:* migration SQL and exact command written for the owner; tests pass for ownership, approve/reject, approved-only public reads and the unique constraint; existing CHECK constraints not assumed altered by a push; `replit_uid` columns kept.
- **9.6 Posting and approval — not started.** *Gate:* “Post an update” shows a real database count of backers to be emailed and “Waiting for review” after posting; the admin queue states before approval whether an email will be sent or skipped under the 14-day rule.
- **9.7 Backer email — not started.** *Gate:* only consenting confirmed backers get rows; each row is claimed before the provider call; uncertain sends are never retried; copy matches DECISIONS.md verbatim with the one “Increase my pledge” button; the button needs normal sign-in and opens repeat interest for that project; increases record their source update. Without Mailjet secrets rows are recorded as `unconfigured`; real delivery is checked once Mailjet is configured.
- **9.8 Timeline and backer view — not started.** *Gate:* public timeline of approved updates only, newest first, ending at the listing date; filmmaker totals and backer list; admin per-update emails sent, increases, and new pledges in the 14 days after.
- **9.9 Money date — not started.** *Gate:* “Your timeline” fields with skip stored separately from blank; development amount labelled wherever budget shows; private countdown with skipped/passed handling and no zero budget line; dates absent from public pages, Explore and backer emails; both dates in admin and its CSV.
- **9.10 Quiet projects and research question — not started.** *Gate:* admin quiet-project list (no approved update in 30 days; list only); optional post-signing research question with verbatim copy, stored answers and admin counts; this section updated with evidence.

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
| Project pages precede the Ask and investor flows; the home page links to `/invest` before investor launch. | A filmmaker's shared link or the home CTA could lead to a dead end and feel unfinished. | Until each flow opens, use a clear “opening later” state rather than a working-looking button; keep the future route only if it explains what is available now. *(No longer applies: pledging is open from day one; see DECISIONS.md and Phase 9.3.)* |
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