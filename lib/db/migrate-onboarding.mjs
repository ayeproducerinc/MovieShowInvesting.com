import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  await pool.query(`
    begin;
    alter table projects add column if not exists proposal jsonb;
    alter table projects add column if not exists team_info text;
    alter table projects add column if not exists public_filmmaker_name text;
    alter table projects add column if not exists submission_snapshot jsonb;
    alter table projects add column if not exists crowdfunding jsonb;
    alter table projects add column if not exists review_notes jsonb;
    alter table projects add column if not exists review_history jsonb;
    alter table investors add column if not exists submitted_answers jsonb;
    alter table investors add column if not exists confirmation_evidence jsonb;
    alter table interest_entries add column if not exists submitted_answers jsonb;
    alter table interest_entries add column if not exists confirmation_evidence jsonb;
    alter table investor_account_progress add column if not exists id bigserial;
    alter table investor_account_progress add column if not exists first_seen_at timestamptz;
    alter table investor_account_progress add column if not exists verified_email text;
    alter table investor_account_progress add column if not exists email_verified_at timestamptz;
    create unique index if not exists investor_progress_admin_id on investor_account_progress(id);
    create table if not exists investor_notification_events (
      id serial primary key,
      provider text not null check (provider in ('firebase', 'replit')),
      uid text not null,
      allowed boolean not null,
      version text not null,
      recorded_at timestamptz not null default now()
    );
    create index if not exists investor_notification_identity_idx on investor_notification_events(provider, uid, id desc);
    create table if not exists age_confirmations (
      provider text not null,
      uid text not null,
      confirmed_at timestamptz not null default now(),
      primary key (provider, uid)
    );
    commit;
  `);
  console.info("Onboarding schema ready; existing projects and records unchanged.");
} finally {
  await pool.end();
}