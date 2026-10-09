# Movie Show Investing — Locked Decisions

These product rules are locked for the MVP. Change them only when the owner explicitly approves a change.

## Product and scope

- Brand: **Movie Show Investing**, a filmmaker–investor matching platform owned by AYe Producer, Inc. The AYeList is named only on the FAQ page.
- The site collects non-binding pledges and indications of interest. No trades or money movement occur in this MVP.
- Investor pledging opens at the same time as filmmaker posting; there is no “opening later” gate for investors. A project page accepts pledges once the filmmaker has submitted the project and it is not hidden, whether or not it is approved. Explore still lists approved projects only, and public pledge counts still show confirmed pledges only, on approved projects only. Pledging must work even when email is not configured; those emails are logged as unconfigured. Before approval, the project's own signed-in filmmaker sees the confirmed total on their project page; no one else does (owner decision, 2026-10-09). Unlisted project pages show everything an approved page shows (trailer, poster, pitch deck, budget and proposed terms, payback goal, sharing, link-preview image); only the Explore listing, the public pledge total, the showcase-status box and search-engine indexing differ, and unlisted pages stay out of search (owner decision, 2026-10-09; the owner accepts that uploads are visible to anyone with the link before admin review, and Hide still removes the page). *(Replaces: “pitch decks publicly viewable from eligible approved Explore listings”, and approval-only trailers, posters and terms on project pages.)* *(Replaces: “Filmmakers launch first. Investor signup and pledges launch later, after approved projects are available.”)*
- The project is unlisted by default. “Private” means accessible to people with its link, not access-controlled. Do not describe an unlisted page as confidential or password-protected.
- A filmmaker can request to showcase a project, but it appears in Explore only after admin approval and only while it is not hidden.
- Do not add investor payments, banking, escrow, Greenlights, leaderboards, public Q&A, unrestricted direct messages, or tiered rates. The owner approved a separate $49 one-time editorial pitch-review fee, with a free unlisted pitch option; paid review does not guarantee public listing. Investor allocations within one non-binding lineup may be edited. Approved messaging exception: one private, text-only investor–filmmaker conversation per project and investor, accessible only to verified participants and authorized admins, with reporting, admin review/lock controls, and an audit trail. Do not open it to real users until owner-approved messaging privacy wording and moderation controls are in place. Approved outreach exception: Project Updates emails (see “Project updates” below), sent after owner approval to confirmed backers who have not turned update emails off. No other automatic outreach.
- Share loglines and synopses, not full scripts.
- The owner does not have Cloudflare yet and deferred Turnstile until the build is complete. No Cloudflare challenge is part of the current filmmaker submission; existing honeypot and rate limits still apply. Stray Cloudflare settings must not gate the form. A future Turnstile integration requires a separate owner-approved launch and proper verification. Do not claim the form has Cloudflare protection before it does.

## Slates and offers

### New structured onboarding proposals

The owner approved these terms for new proposals. They supersede the historical table below for new submissions only; existing submissions and signed investor records retain their original terms.

| Stage | Total investor repayment per $100, including capital | Platform spread per $100 of original investment | Backend split |
|---|---:|---:|---|
| Distribution | $125 | $15 | 50% investor / 50% filmmaker |
| Production | $150 | $10 | 50% investor / 50% filmmaker |
| Idea | $175 | $5 | 50% investor / 50% filmmaker |

- The platform spread is separate from the investor target and does not reduce it. It is not a recurring percentage of revenue. Retain the existing proportional platform-fee allocation priority; the owner approved new spread amounts, not a different platform-fee collection priority.
- Standard terms have no early filmmaker revenue payments. Under negotiation, a filmmaker may propose an early percentage (10% is an editable example), custom repayment, backend split, and duration. The investor target remains unchanged; early payments may delay reaching it.
- Backend begins after the full investor repayment target, not merely principal. Standard duration is five years. Backend percentages apply to project revenue remaining after payment-processing and distribution fees, not gross revenue; identify each fee separately and never deduct the same fee twice.
- Structured proposals preserve the original suggestion and submitted terms separately. Historic projects without structured backend terms remain unspecified, not retrospectively 50/50.

### Historical offers (do not apply to new structured proposals)

| Slate | Project stage | Default investor offer per $100 | Platform fee per $100 | Filmmaker share after payback |
|---|---|---:|---:|---:|
| Distribution | Looking for distribution or already distributed | $125 | $25 (Group B test: $15) | $67 of each $100 |
| Production | Short or pilot to develop | $150 | $20 | $60 of each $100 |
| Idea | Script or idea | $175 | $15 | All of it |

- Offers are rates per $100, not fixed-dollar amounts. Investor payback goal = pledge amount × project offer ÷ 100.
- The filmmaker may select $125, $150, $175, $200, or another amount of at least $125. An offer below $125 cannot be submitted.
- “I’d need to offer less than $125” is captured as `wants_lower`; the project is still listed at $125.
- Project stages are exactly **Idea**, **Production**, and **Distribution**. “Other” is not a project stage or investor stage preference. Preserve unrelated “Other” answers for genres, offers, funding, and payback terms. Do not silently remap any legacy project if a stored “Other” stage appears elsewhere.
- Price-test Group B applies only to Distribution and uses a $15 fee per $100. Assign each visitor once, 50/50, and retain the assignment.
- The investor-facing project payback goal is based on the investor offer only. The platform fee is a separate amount owed by the filmmaker.

## Phase 1 allocation rule

- The historical after-payback shares below apply only to older submissions. New structured proposals use the approved backend terms above.
- The amount due in Phase 1 is the investor payback target plus the platform fee.
- After payment-processing fees, all available project receipts go into a Phase 1 pool. Allocate the pool proportionally between the outstanding investor target and platform fee until both are satisfied.
- Show the investor target, platform fee, and combined Phase 1 amount as separate figures to filmmakers.
- Do not say that the entire combined amount is paid to investors. Investor-facing pages must not describe a payment order.
- This is the approved working rule for the MVP. Any change requires the owner’s approval.
- After Phase 1, the filmmaker shares listed above apply. The recipient or recipients of any remaining share are not yet specified and must not be invented.

## Investor language and notices

- Both filmmaker and investor onboarding require a dated, account-owned, self-declared 18+ acknowledgment; server enforcement also applies to submissions, signatures, and paid review checkout. Public browsing remains ungated.
- Below the age checkbox, explain future date-of-birth and government photo-ID verification through KYC before investing (investor flow) or receiving funding (filmmaker flow). No birth dates or IDs are collected now; onboarding guarantees neither an offering nor eligibility. Use the owner's exact role-specific text.
- Use “Payback goal: $X for every $100” for project offers and “Payback goal: $X back on your $Y” for a specific pledge.
- Do not describe a payback goal as a return, earnings, an expectation, or a realistic outcome. Never imply that a payback is guaranteed.
- Required risk disclosure: **“Returns aren’t guaranteed. You may get back less, or nothing.”** This exact disclosure is permitted wherever the prohibition above would otherwise rule out the word “returns.”
- Questions about fixed payback versus profit share collect preferences for research; they do not create live investment terms. Do not promise a profit share that has not been decided.
- Owner-approved pledge encouragement (2026-10-09), shown on pledge screens above the amount, never in place of or between the risk disclosure and a figure: **“Every breakout film started with someone who believed in it first. Your pledge tells this filmmaker their story is worth telling, and helps show others it has an audience.”** It speaks to belief and the filmmaker, not to payback or likely success; do not add financial-outcome wording to it.
- Place the required risk disclosure next to investor-facing pledge and payback figures, including in results, emails, project pages, Explore, and lineup views.
- Securities notice at the top of Explore and every project page: **“Pledge your interest in future investment opportunities. If a project opens for investment, it will be offered only in compliance with securities laws, and you'll get full offering documents before you decide.”**
- Footer on every page: **“Pledges are non-binding. No money is collected. This is not an offer to sell securities.”**
- Every count shown to users must be a real database value. Public pledge counts include confirmed pledges only, and appear only on approved projects (see the open-pledging rule under Product and scope).

### Backer names

Owner revision, 2026-10-09, of the brief's “Backer names” phase.

- The filmmaker and authorized admins always see each backer's name, email and confirmed pledge amount for that project. There is no checkbox for this. *(Replaces: the brief's opt-in “Also share my email with the filmmaker.” checkbox.)*
- At the signing step, show: **“The filmmaker will see your name, email and pledge amount.”** *(Replaces: the brief's “The filmmaker will see your name and pledge amount.”)*
- Public display is opt-in. At the signing step, a checkbox that is off by default: **“Show my name and pledge amount publicly on this project's page and in Explore.”** Only backers who tick it appear publicly by name and amount, and only where public pledge figures are already allowed (confirmed pledges on approved projects). *(Replaces: “Names are never shown publicly.” and the “public backer names” do-not-add item.)*
- Store which version of this notice the investor saw, and their public-display choice, with each signed entry, the way consent is stored elsewhere (`confirmation_evidence.notice_version`, `investor_notification_events`).
- A pledge signed before this notice existed shows to the filmmaker as “Backer (name not shared)” with its amount and no email, and never appears publicly.
- The AYeList is not named on project pages, Explore, or investor/filmmaker flows; it is named only in the FAQ.

## Investor pledge limits and matching

- Minimum $100 per project, everywhere. *(Replaces: “Minimum lineup total: $100. Minimum amount per project: $25.”)*
- Up to 5 projects per pledge. *(Replaces: “A pledge under $150 can contain at most 4 projects; a pledge of $150 or more can contain at most 5.”)*
- Pledges already signed keep their original amounts; do not rewrite them. Leave the existing database minimum check (`pledges_amount_minimum_check`, amount ≥ 25) alone and enforce $100 for new pledges in the application.
- Two ways in. From a project page (the link a filmmaker shares), the investor pledges to that one project only, $100 or more. From Explore, the investor can choose several projects, $100 or more each. Both keep the age acknowledgment, sign-in, and the single review-sign-confirm step; no second signature. Before the one-project path is built, its exact steps (the fewest the locked rules allow) are listed for owner approval. Owner decision (2026-10-09): two screens after sign-in — “Your pledge” (approved encouragement line, amount with payback goal and risk disclosure, ground rules, 18+) then “Review and sign” (project and amount, contact details, single signature). This is one screen more than the minimum, chosen for phone length and a clear review moment. It skips the matching-only screens (interests, repayment minimums, lineup) and the experience and motivation questions.
- One lineup per investor email. Default allocation is an equal split; any remainder goes to the first project.
- Investor minimum ladder, per $100: $125, $150, $175, $200, $250+, Other, or Not interested for each slate.
- An offer matches an investor’s selected minimum only when it meets or exceeds that minimum. “Not interested” is never a match.
- Market figures are hidden until at least 20 answers exist for the applicable slate. The investor repayment page shows platform-standard targets for selected stages, not market figures or individual filmmaker offers. Explain original money back plus additional return, and distinguish matching preferences from project terms.
- Investors review, sign, and confirm their non-binding interest once in the final worksheet before Submit. The normal journey has no post-submit confirmation screen. Age and introductory ground-rules acknowledgment remain separate; exact-record ownership, freshness, retry safeguards and immutable earlier signatures remain required.

## Data, authentication, and implementation

- Use the existing project’s React/Vite frontend and Express API with PostgreSQL/Drizzle. Do not add a Flask server or a second API server.
- Keep the API contract OpenAPI-first and use the generated client/schema packages already in the project.
- Google sign-in through the existing Firebase project is the only user-facing sign-in option for filmmakers, investors, and admin. Firebase phone verification remains separate. Email-link and Replit sign-in controls are removed; new Replit OIDC sign-ins are disabled, while old sessions and account data are retained for safe cleanup. Never merge ownership across providers merely because emails match. Guest project claims still require proof from the original browser and a matching verified email. Legacy email-link accounts that were not linked to Google may require an owner-verified recovery path.
- The verified signed-in account identifies a messaging participant; Mailjet may notify them about a new message but is not the conversation record. Notification failure must not erase an internal message or expose its contents to email recipients.
- The owner approved the messaging notice: “Project messages are visible to the signed-in investor and the filmmaker for that project. Authorized Movie Show Investing administrators can also read messages and reports, review safety concerns, and lock conversations. Messages are stored on the platform. Email notifications, if enabled, contain no message text. Do not share confidential scripts or sensitive personal or financial information.” Display it in the conversation flow and Privacy page; do not replace it without approval.
- The admin area uses a server-verified allowlist, not a separate admin password. Firebase admin access requires the verified configured email. Replit admin access additionally requires an explicitly provisioned, immutable provider subject; email match alone never grants admin access. The previously supplied admin password is unused.
- Use Replit Secrets for credentials and environment-specific configuration; never put secret values in source files or ask the user to paste them into chat.
- Save flow progress as the user proceeds so funnel drop-off and pricing answers can be analyzed.
- New investor worksheet/profile entry requires sign-in before step 1. New filmmaker pitches may begin as guest drafts, but require sign-in and account linkage on the final step before final submission or optional editorial-review checkout. Sign-in is account/email verification, not formal KYC or a signature confirming investor interest.
- Optional synopsis, trailer links/uploads, posters, share images, and a single uploaded pitch deck belong on the filmmaker title/logline step behind checkbox-revealed controls. Materials must persist with the draft through refresh and sign-in and attach to the correct submitted project; hiding a control must not silently delete saved material.
- The owner wants pitch decks publicly viewable on every visible project page (submitted and not hidden, listed or unlisted; see Product and scope), and all pitch answers/attachments available to authorized admin review. Tell filmmakers that decks will be public on their project page before uploading. Draft and hidden decks are not exposed through the public document route, and replacing approved content follows the existing re-review rules.
- This onboarding change prevents new guest submissions from being stranded; it does not add recovery for older guest submissions when their original browser proof is gone.

## Project updates

Filmmakers look for money last, after the script, cast and budget are done. These features let them start on day one: collect pledges early, keep backers informed as the film progresses, and see their own deadline. A filmmaker posts a milestone, the owner approves it, and each confirmed backer who has not turned update emails off gets an email with one button to increase their pledge. The measure the owner needs is how many backers increased, and how many new pledges came in, after each update.

### Locked rules

a. The owner approves every update in admin before it appears publicly or is emailed.
b. A milestone never changes a project's stage. Stage still sets the payback goal and changes only through the existing reviewed path.
c. At most one update email per project every 14 days. If one already went out in that window, the approved update shows on the timeline but no email is sent. Tell the admin which will happen before they approve.
d. Update emails are on by default for every confirmed backer of the project. A backer stops getting them only after turning them off — by the one-click link in any update email or the switch on My lineup — recorded in `project_update_email_events` (latest choice wins). The signing step says: “You’ll get an email when a project you back posts an update. You can turn these off anytime.” Every update email carries the turn-off link and is not sent without it. This preference is separate from the offering-notification permission. *(Replaces, owner decision 2026-10-09: “Email only confirmed backers … whose latest notification-permission record is ‘allowed’. A missing choice is not consent.” The owner was told that US law (CAN-SPAM) requires an opt-out for promotional email and some countries require opt-in; legal review is recommended.)*

*(Replaces: the earlier Project Updates rules 1–7 drafted on 2026-10-09. The email-button and repeat-interest rules now sit under Email content; the public-count rule is under Product and scope and Investor language.)*

### Milestone list (fixed keys, grouped by stage)

The filmmaker sees their own stage's group plus the “Any stage” group.

| Group | Milestone | Key |
|---|---|---|
| Idea | Script draft finished | `script_draft_finished` |
| Idea | Script locked | `script_locked` |
| Idea | Budget and schedule done | `budget_schedule_done` |
| Idea | Lead cast attached | `lead_cast_attached` |
| Idea | Pitch trailer or proof of concept out | `proof_of_concept_out` |
| Production | Locations secured | `locations_secured` |
| Production | Shoot dates set | `shoot_dates_set` |
| Production | Filming started | `filming_started` |
| Production | Filming wrapped | `filming_wrapped` |
| Production | Final cut locked | `final_cut_locked` |
| Distribution | Festival selection | `festival_selection` |
| Distribution | Award or notable press | `award_or_press` |
| Distribution | Sales agent or distributor signed | `distributor_signed` |
| Distribution | Release date set | `release_date_set` |
| Distribution | Released | `released` |
| Any stage | Team member joined | `team_member_joined` |
| Any stage | Other funding secured | `other_funding_secured` |
| Any stage | Other (filmmaker writes a short label) | `other` |

- “Team member joined” asks for a role (Producer, Director, Writer, Executive producer, Cinematographer, Casting director, Other) and an optional name. A name is stored and shown only if the filmmaker ticks a box confirming that person agreed to be named publicly. It can be used more than once.
- An optional filmmaker note is capped at 500 characters and appears only after owner approval.

### Email content

- Project title, the milestone, the approved note, the backer's own confirmed pledge amount for that project, and exactly one button: **“Increase my pledge”**. Do not add “I'm still in”, “step back”, “withdraw”, or any re-confirmation.
- Next to the pledge amount, verbatim: **“Returns aren't guaranteed. You may get back less, or nothing.”**
- End with, verbatim: **“Pledges are non-binding. No money is collected. This is not an offer to sell securities.”**
- Do not call the payback goal a return, earnings, or an expectation. Do not name The AYeList.
- The button links to the project page and requires normal sign-in; no login tokens in the link. After sign-in it opens the existing repeat-interest flow for that project: a new, separate signed entry. Never edit an earlier signed record. A later increase records which update it came from.
- Delivery uses the existing Mailjet helper and email log; each row is claimed before contacting the provider and an uncertain send is never retried automatically.

### Timeline and backer view

- Project page: a “Progress” timeline of approved updates, newest first, ending with the date the project was listed. Filmmaker-posted milestones only; no automatic pledge-count entries. No listing-date column exists today; the listing date is the latest approval entry in `projects.review_history`.
- Filmmaker project area: totals (backers and amount pledged, number who increased and by how much, new pledges since the last update, date of last update), then the backer list: name, email, amount and date (see Backer names; pre-notice pledges show as “Backer (name not shared)”).
- Admin: per update, emails sent, increases, and new pledges in the 14 days after it.

## Money date

- In filmmaker intake and Edit pitch, a “Your timeline” section with two optional month-and-year fields: “When do you plan to start filming?” and “When do you need the money by?” Include “Skip for now”, recorded as a skip, separate from a blank.
- An optional “Development amount” next to the full budget, shown clearly labelled wherever the budget is shown today.
- In the filmmaker's private project area: money needed by, time left in months, pledged so far (real confirmed total), development amount, and budget. If a date was skipped, prompt to add it. If it has passed, say so and offer to update it. If there is no budget, leave that line out; do not show a zero.
- The dates and countdown are private to the filmmaker and admin: never on the public page, in Explore, or in any email to backers.
- Admin shows both dates per project and includes them in the existing CSV export.
- Implementation (2026-10-09): stored in a separate `project_money_dates` table so existing project queries are unaffected. The development amount is set at intake, like the budget; Edit pitch changes only the two dates, and those private edits never pause an approved listing.

## Admin follow-up and research

- Quiet-project list: an admin page of projects with no approved update in 30 days, showing title, filmmaker contact, last update date, and number of backers. A list only; no automatic messages.
- Research question: after an investor signs, ask one optional question: **“If you could set this money aside today and earn interest until the offering opens, would you?”** Answers: Yes, No, Not sure. Under it show: **“This is a research question. No account is being offered.”** Store the answer and show the counts in admin.

## Do not add (pledge-first features)

A progress checklist or “suggested next” prompt, automatic reminders or scheduled jobs, “still in” tracking, progress bars or percentages, stage changes from milestones, a digest email, push or SMS, public backer names without the backer's opt-in (see Backer names), a public deadline, or any payment, deposit, or bank feature. *(Replaces: the earlier Project Updates “Do not add” list.)*

## Open decisions — do not guess

- Recipients and allocation of the remaining 33% Distribution share and 40% Production share after payback.
- Idea Slate example budgets ($50,000 feature and $65,000 series are provisional examples).
- Pass thresholds for the six demand tests.
- Investor-facing “Returns” motivation and the longer project-page disclaimer in the guides conflict with the banned investor wording. The exact required short risk disclosure above remains the exception; do not silently adopt the conflicting copy or invent replacements.
- Any later profit-share terms, rate tiers, or payment waterfall beyond the current MVP rules.
- Privacy page wording for backer names: what the filmmaker and admin see (name, email, pledge amount) and the opt-in public display. Needs owner-approved text before launch.