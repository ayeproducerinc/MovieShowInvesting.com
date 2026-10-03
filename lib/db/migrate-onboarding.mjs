import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  await pool.query(`
    begin;
    alter table projects add column if not exists proposal jsonb;
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