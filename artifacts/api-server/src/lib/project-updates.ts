/**
 * Project updates (DECISIONS.md › Project updates). Milestones never change a
 * project's stage; the owner approves every update; at most one update email
 * per project every 14 days; only consenting confirmed backers are emailed.
 */
export type MilestoneGroup = "idea" | "production" | "distribution" | "any";

export const MILESTONES: { key: string; label: string; group: MilestoneGroup }[] = [
  { key: "script_draft_finished", label: "Script draft finished", group: "idea" },
  { key: "script_locked", label: "Script locked", group: "idea" },
  { key: "budget_schedule_done", label: "Budget and schedule done", group: "idea" },
  { key: "lead_cast_attached", label: "Lead cast attached", group: "idea" },
  { key: "proof_of_concept_out", label: "Pitch trailer or proof of concept out", group: "idea" },
  { key: "locations_secured", label: "Locations secured", group: "production" },
  { key: "shoot_dates_set", label: "Shoot dates set", group: "production" },
  { key: "filming_started", label: "Filming started", group: "production" },
  { key: "filming_wrapped", label: "Filming wrapped", group: "production" },
  { key: "final_cut_locked", label: "Final cut locked", group: "production" },
  { key: "festival_selection", label: "Festival selection", group: "distribution" },
  { key: "award_or_press", label: "Award or notable press", group: "distribution" },
  { key: "distributor_signed", label: "Sales agent or distributor signed", group: "distribution" },
  { key: "release_date_set", label: "Release date set", group: "distribution" },
  { key: "released", label: "Released", group: "distribution" },
  { key: "team_member_joined", label: "Team member joined", group: "any" },
  { key: "other_funding_secured", label: "Other funding secured", group: "any" },
  { key: "other", label: "Other", group: "any" },
];

export const TEAM_ROLES: { key: string; label: string }[] = [
  { key: "producer", label: "Producer" },
  { key: "director", label: "Director" },
  { key: "writer", label: "Writer" },
  { key: "executive_producer", label: "Executive producer" },
  { key: "cinematographer", label: "Cinematographer" },
  { key: "casting_director", label: "Casting director" },
  { key: "other", label: "Other" },
];

export const NOTE_MAX = 500;
export const LABEL_MAX = 60;
export const NAME_MAX = 80;
export const EMAIL_WINDOW_DAYS = 14;

/** The filmmaker sees their own stage's group plus "Any stage". */
export function milestonesForStage(stage: string | null) {
  return MILESTONES.filter((milestone) => milestone.group === "any" || milestone.group === stage);
}

export type UpdateInput = {
  milestone_key: string;
  role?: string | null;
  person_name?: string | null;
  name_consent?: boolean | null;
  custom_label?: string | null;
  note?: string | null;
};
export type UpdateValue = {
  milestone_key: string;
  role: string | null;
  person_name: string | null;
  name_consent: boolean;
  custom_label: string | null;
  note: string | null;
};

const clean = (value: string | null | undefined) => {
  const text = (value ?? "").trim().replace(/\s+/g, " ");
  return text || null;
};

export function validateUpdateInput(stage: string | null, input: UpdateInput):
  { ok: true; value: UpdateValue } | { ok: false; error: string } {
  if (!milestonesForStage(stage).some((milestone) => milestone.key === input.milestone_key)) {
    return { ok: false, error: "Choose a milestone for this project's stage." };
  }
  const note = (input.note ?? "").trim() || null;
  if (note && note.length > NOTE_MAX) return { ok: false, error: `Keep the note to ${NOTE_MAX} characters or fewer.` };
  const value: UpdateValue = {
    milestone_key: input.milestone_key, role: null, person_name: null, name_consent: false, custom_label: null, note,
  };
  if (input.milestone_key === "team_member_joined") {
    if (!TEAM_ROLES.some((role) => role.key === input.role)) return { ok: false, error: "Choose the new team member's role." };
    value.role = input.role!;
    const name = clean(input.person_name);
    if (name && name.length > NAME_MAX) return { ok: false, error: `Keep the name to ${NAME_MAX} characters or fewer.` };
    // A name is stored only when the filmmaker confirms the person agreed to be named publicly.
    if (name && input.name_consent === true) {
      value.person_name = name;
      value.name_consent = true;
    }
  }
  if (input.milestone_key === "other") {
    const label = clean(input.custom_label);
    if (!label) return { ok: false, error: "Add a short label for this update." };
    if (label.length > LABEL_MAX) return { ok: false, error: `Keep the label to ${LABEL_MAX} characters or fewer.` };
    value.custom_label = label;
  }
  return { ok: true, value };
}

/** Rule c: skip the email when this project already had one in the last 14 days. */
export function emailDecision(lastQueuedAt: Date | null, now: Date): "send" | "skip_recent" {
  if (!lastQueuedAt) return "send";
  return now.getTime() - lastQueuedAt.getTime() < EMAIL_WINDOW_DAYS * 24 * 60 * 60 * 1000 ? "skip_recent" : "send";
}

/** Only pending updates can be approved or rejected, once. */
export function nextStatus(current: string, action: "approve" | "reject"): "approved" | "rejected" | null {
  if (current !== "pending") return null;
  return action === "approve" ? "approved" : "rejected";
}

export function milestoneLabel(key: string, customLabel: string | null): string {
  if (key === "other" && customLabel) return customLabel;
  return MILESTONES.find((milestone) => milestone.key === key)?.label ?? key;
}

export type UpdateRow = {
  id: number;
  milestone_key: string;
  role: string | null;
  person_name: string | null;
  name_consent: boolean;
  custom_label: string | null;
  note: string | null;
  status: string;
  created_at: Date;
  reviewed_at: Date | null;
};

/** Public view of an approved update: the name appears only with consent. */
export function publicUpdateView(row: UpdateRow) {
  return {
    id: row.id,
    milestone_key: row.milestone_key,
    label: milestoneLabel(row.milestone_key, row.custom_label),
    role: row.role ? TEAM_ROLES.find((role) => role.key === row.role)?.label ?? row.role : null,
    person_name: row.name_consent ? row.person_name : null,
    note: row.note,
    approved_at: (row.reviewed_at ?? row.created_at).toISOString(),
  };
}

/** The filmmaker's own view, any status. */
export function filmmakerUpdateView(row: UpdateRow) {
  return {
    ...publicUpdateView(row),
    status: row.status as "pending" | "approved" | "rejected",
    created_at: row.created_at.toISOString(),
    reviewed_at: row.reviewed_at?.toISOString() ?? null,
  };
}

/**
 * Rule d: confirmed backers of the project whose latest notification-permission
 * record is "allowed". A missing record is not consent.
 */
export const CONSENTING_BACKERS_SQL = `
  select distinct i.id as investor_id
  from pledges pl
  join investors i on i.id = pl.investor_id
  join lateral (
    select ev.allowed from investor_notification_events ev
    where (ev.provider = 'firebase' and ev.uid = i.firebase_uid)
       or (ev.provider = 'replit' and ev.uid = i.replit_uid)
    order by ev.recorded_at desc, ev.id desc
    limit 1
  ) latest on true
  where pl.project_id = $1 and pl.confirmed = true and latest.allowed = true`;
