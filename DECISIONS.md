# Movie Show Investing — Locked Decisions

These product rules are locked for the MVP. Change them only when the owner explicitly approves a change.

## Product and scope

- Brand: **Movie Show Investing**, a filmmaker–investor matching platform owned by AYe Producer, Inc. The AYeList is named only on the FAQ page.
- The site collects non-binding pledges and indications of interest. No trades or money movement occur in this MVP.
- Filmmakers launch first. Investor signup and pledges launch later, after approved projects are available.
- The project is unlisted by default. “Private” means accessible to people with its link, not access-controlled. Do not describe an unlisted page as confidential or password-protected.
- A filmmaker can request to showcase a project, but it appears in Explore only after admin approval and only while it is not hidden.
- Do not add investor payments, banking, escrow, Greenlights, leaderboards, public Q&A, unrestricted direct messages, or tiered rates. The owner approved a separate $49 one-time editorial pitch-review fee, with a free unlisted pitch option; paid review does not guarantee public listing. Investor allocations within one non-binding lineup may be edited. Approved messaging exception: one private, text-only investor–filmmaker conversation per project and investor, accessible only to verified participants and authorized admins, with reporting, admin review/lock controls, and an audit trail. Do not open it to real users until owner-approved messaging privacy wording and moderation controls are in place.
- Share loglines and synopses, not full scripts.
- The owner does not have Cloudflare yet and deferred Turnstile until the build is complete. Filmmaker submissions must work without its keys using the existing honeypot and rate limits; if Turnstile is configured later, enforce and verify it rather than silently bypassing a partial setup. Do not claim the form has Cloudflare protection before it does.

## Slates and offers

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

- The amount due in Phase 1 is the investor payback target plus the platform fee.
- After payment-processing fees, all available project receipts go into a Phase 1 pool. Allocate the pool proportionally between the outstanding investor target and platform fee until both are satisfied.
- Show the investor target, platform fee, and combined Phase 1 amount as separate figures to filmmakers.
- Do not say that the entire combined amount is paid to investors. Investor-facing pages must not describe a payment order.
- This is the approved working rule for the MVP. Any change requires the owner’s approval.
- After Phase 1, the filmmaker shares listed above apply. The recipient or recipients of any remaining share are not yet specified and must not be invented.

## Investor language and notices

- Use “Payback goal: $X for every $100” for project offers and “Payback goal: $X back on your $Y” for a specific pledge.
- Do not describe a payback goal as a return, earnings, an expectation, or a realistic outcome. Never imply that a payback is guaranteed.
- Required risk disclosure: **“Returns aren’t guaranteed. You may get back less, or nothing.”** This exact disclosure is permitted wherever the prohibition above would otherwise rule out the word “returns.”
- Questions about fixed payback versus profit share collect preferences for research; they do not create live investment terms. Do not promise a profit share that has not been decided.
- Place the required risk disclosure next to investor-facing pledge and payback figures, including in results, emails, project pages, Explore, and lineup views.
- Securities notice at the top of Explore and every project page: **“Pledge your interest in future investment opportunities. If a project opens for investment, it will be offered only in compliance with securities laws, and you'll get full offering documents before you decide.”**
- Footer on every page: **“Pledges are non-binding. No money is collected. This is not an offer to sell securities.”**
- Every count shown to users must be a real database value. Public pledge counts include confirmed pledges only.
- The AYeList is not named on project pages, Explore, or investor/filmmaker flows; it is named only in the FAQ.

## Investor pledge limits and matching

- Minimum lineup total: $100. Minimum amount per project: $25.
- A pledge under $150 can contain at most 4 projects; a pledge of $150 or more can contain at most 5.
- One lineup per investor email. Default allocation is an equal split; any remainder goes to the first project.
- Investor minimum ladder, per $100: $125, $150, $175, $200, $250+, Other, or Not interested for each slate.
- An offer matches an investor’s selected minimum only when it meets or exceeds that minimum. “Not interested” is never a match.
- Market figures are hidden until at least 20 answers exist for the applicable slate. Never show market figures or filmmaker offers on the investor terms page.

## Data, authentication, and implementation

- Use the existing project’s React/Vite frontend and Express API with PostgreSQL/Drizzle. Do not add a Flask server or a second API server.
- Keep the API contract OpenAPI-first and use the generated client/schema packages already in the project.
- Google sign-in through the existing Firebase project is the only user-facing sign-in option for filmmakers, investors, and admin. Firebase phone verification remains separate. Email-link and Replit sign-in controls are removed; new Replit OIDC sign-ins are disabled, while old sessions and account data are retained for safe cleanup. Never merge ownership across providers merely because emails match. Guest project claims still require proof from the original browser and a matching verified email. Legacy email-link accounts that were not linked to Google may require an owner-verified recovery path.
- The verified signed-in account identifies a messaging participant; Mailjet may notify them about a new message but is not the conversation record. Notification failure must not erase an internal message or expose its contents to email recipients.
- The owner approved the messaging notice: “Project messages are visible to the signed-in investor and the filmmaker for that project. Authorized Movie Show Investing administrators can also read messages and reports, review safety concerns, and lock conversations. Messages are stored on the platform. Email notifications, if enabled, contain no message text. Do not share confidential scripts or sensitive personal or financial information.” Display it in the conversation flow and Privacy page; do not replace it without approval.
- The admin area uses a server-verified allowlist, not a separate admin password. Firebase admin access requires the verified configured email. Replit admin access additionally requires an explicitly provisioned, immutable provider subject; email match alone never grants admin access. The previously supplied admin password is unused.
- Use Replit Secrets for credentials and environment-specific configuration; never put secret values in source files or ask the user to paste them into chat.
- Save flow progress as the user proceeds so funnel drop-off and pricing answers can be analyzed.

## Open decisions — do not guess

- Recipients and allocation of the remaining 33% Distribution share and 40% Production share after payback.
- Idea Slate example budgets ($50,000 feature and $65,000 series are provisional examples).
- Pass thresholds for the six demand tests.
- Investor-facing “Returns” motivation and the longer project-page disclaimer in the guides conflict with the banned investor wording. The exact required short risk disclosure above remains the exception; do not silently adopt the conflicting copy or invent replacements.
- Any later profit-share terms, rate tiers, or payment waterfall beyond the current MVP rules.