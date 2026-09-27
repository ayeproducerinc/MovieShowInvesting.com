# Movie Show Investing — Build Plan

Build one phase at a time. Each phase ends at its stated gate; do not start the next phase without the owner’s direction. All statuses begin as `not started`.

## Phase 1 — Setup and shell

**Status:** not started  
**Deliverables:**

- React/Vite and Tailwind frontend integrated with the existing Express API and PostgreSQL/Drizzle setup.
- A working home page with the required headline, filmmaker and investor entry buttons, and a real filmmaker count that is hidden when zero.
- Mobile-first shared shell, header, required footer, and `/privacy`, `/terms`, `/disclaimers`, and `/faq` pages.
- Firebase web configuration returned by `/api/config`; initialize Firebase Auth without building sign-in screens yet.
- A one-year visitor ID cookie and capture of `utm_source`, `utm_medium`, `utm_campaign`, and `ref` codes.
- All API routes use `/api`; all data counts come from the database.

**Gate:** Home and shared pages load; visitor and campaign data are recorded; the setup scenarios in the Visual Guide pass.

## Phase 2 — Data model and admin

**Status:** not started  
**Deliverables:**

- PostgreSQL models for Visitor, Filmmaker, Project, Investor, Pledge, InvestorMinimum, Message, FlowProgress, and EmailLog, including the fields specified in the Prompt Guide.
- Progress-save API and one-time visitor price-group assignment.
- Password-protected `/admin` with ten sections: Summary; Pledges by project; By location; Funnels; Market; Price test; Queues; Messages; Channels; Email log.
- CSV export for every admin table; approval and hide controls; real database counts.

**Gate:** Visual Guide scenario S2 passes: wrong admin password is refused, empty sections show zeroes, and all CSV exports include headers.

## Phase 3 — Filmmaker flow

**Status:** not started  
**Deliverables:**

- Six-screen flow at `/start/filmmaker`, with progress, back navigation, auto-advance where specified, and progress saved after every screen for same-device resume.
- Project stage, project details, budget tabs, standard-deal calculator, deal response, offer selection, financing history, and contact information.
- Enforce the $125 offer floor; save `wants_lower` while listing the offer at $125.
- Implement the approved Phase 1 pool calculation, showing the investor target, fee, combined amount, and filmmaker share as separate values.
- Create filmmaker and project records on submission; support “I don't have a project yet.”

**Gate:** Visual Guide scenarios F1–F5 pass, including pricing math, Group B pricing, offer floor, no-project path, and resume.

## Phase 4 — Project page, result, share, and showcase

**Status:** not started  
**Deliverables:**

- Filmmaker result screen using the selected offer, a share card without dollar amounts, and share/copy actions.
- Unlisted project page with the securities notice, project details, required investor disclosures, and confirmed pledge totals only.
- Showcase request and optional synopsis, team links, money-use, distribution-plan, trailer, and poster fields.
- Bunny Stream uploads for trailers and Bunny Storage/CDN for posters and share images, with the documented size and file-type limits.
- Social link-preview metadata; unapproved pages are noindex. Only approved, non-hidden projects may appear in Explore.
- YouTube/Vimeo oEmbed thumbnails where applicable.

**Gate:** Visual Guide scenarios F6–F8 pass: chosen-offer numbers, share image/preview, approval queue, Explore visibility, and upload limits.

## Phase 5 — Email, sign-in, verification, and filmmaker questions

**Status:** not started  
**Deliverables:**

- Mailjet email sending and logging.
- Firebase email-link sign-in, private `/me` filmmaker page, and phone verification.
- Branded filmmaker submission emails with project/share links and the filmmaker Calendly link when opted in.
- Ask-the-filmmaker relay with Turnstile, hashed answer tokens, email relay that does not expose either party’s email address, report link, and rate limits.
- Unanswered questions first on `/me`; filmmaker can answer from `/me` or the private answer link.

**Gate:** Visual Guide scenarios F9–F11 pass, including branded sign-in, verified badges, and the private question-and-answer relay.

## Phase 6 — Hardening and filmmaker launch

**Status:** not started  
**Deliverables:**

- Mixpanel and Microsoft Clarity events specified in the Prompt Guide.
- Cloudflare Turnstile and server verification on the filmmaker final submit and Ask form; honeypot fields and request limits.
- Prepare Privacy, Terms, and Disclaimers pages using owner-approved copy for launch, including AYe Producer, Inc., message-safety review, and the data-deletion contact.
- Production-domain configuration and Firebase authorized-domain setup.

**Gate:** Filmmaker scenarios F1–F11 pass on the launch domain and the filmmaker side is ready to launch.

## Phase 7 — Explore and investor flow

**Status:** not started  
**Deliverables:**

- Explore with required securities notice, filters, sorting, and approved/non-hidden projects only.
- Matching based on investor minima and interests; match badges only when the offer meets the selected minimum and the project fits the investor’s interests.
- Five investor pages: amount, terms, interests, matches, and about you.
- Equal-split editable lineup, auto-build and unallocated “Just pledge” paths, lineup bar, spread rating, and all pledge limits.
- Investor copy follows the required wording and disclosure rules; do not show offers or market figures on the terms page.

**Gate:** Visual Guide scenarios I1–I6 pass for preferences, matching, pledge limits, split, auto-build, and unallocated pledges.

## Phase 8 — Pledge confirmation and lineup

**Status:** not started  
**Deliverables:**

- Investor result/share card and non-binding pledge-confirmation email containing the signed indication, securities notice, and required disclosures.
- Signed-in `/lineup/confirm` flow; public pledge counts rise only after confirmation.
- Private, view-only `/lineup` with confirmed status, per-project pledge and payback goals, live confirmed totals, and referral count; do not display private contact or accreditation details.
- Find-my-lineup email flow with a uniform response and the specified rate limits.
- Investor analytics events and final copy/disclosure audit.

**Gate:** Visual Guide scenarios I7–I12 pass and the investor side is ready to launch.

## FAQ copy

Use these five questions and answers on `/faq`:

1. **What is Movie Show Investing?** A platform where filmmakers share projects and investors pledge interest, so both sides can find each other before investment opens.
2. **Is my pledge an investment?** No. No trades happen here and no money is collected. A pledge is a non-binding indication of interest. If a project opens for investment, you'll be invited to decide then.
3. **How will money flow when investment opens?** Viewers rent, buy, or license the film → our affiliated distribution platform collects the revenue (payment processing fees come off first) → automated revenue splits pay investors, the filmmaker, and the platform according to the project's terms.
4. **Who's the distribution platform?** Movie Show Investing and The AYeList are both run by AYe Producer, Inc. The AYeList is our distribution channel, with on-demand streaming and automated revenue splits.
5. **How are my ideas protected?** Share loglines and synopses, not full scripts. Consider registering your script with the U.S. Copyright Office or the WGA registry before sharing widely.

## Service and launch dependencies

- Prompt 0 requires no credentials.
- Before Phase 1: enable project PostgreSQL and provide the Firebase web configuration and Firebase service-account JSON. The project database supplies `DATABASE_URL`.
- Before Phase 2: provide the admin password and configure the existing backend’s session secret (`SESSION_SECRET`).
- Before Phase 4: provide Bunny Stream and Bunny Storage/CDN credentials and the site URL.
- Before Phase 5: provide Mailjet credentials/sender and the filmmaker Calendly link.
- Before Phase 6: provide Cloudflare Turnstile and analytics configuration; configure the production domain.
- Before Phase 8: provide accredited-investor and retail Calendly links.

Ask for each value through Replit Secrets when its phase needs it. Never request secret values in chat.