-- Money date (DECISIONS.md › Money date). Additive only: one new table keyed by
-- project. The two dates are private to the filmmaker and admin; the development
-- amount is shown, labelled, wherever the budget is shown. A "skipped" flag is
-- recorded separately from a blank (never answered).
CREATE TABLE IF NOT EXISTS project_money_dates (
  project_id integer PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  development_amount integer,
  filming_start_month text,
  filming_start_skipped boolean NOT NULL DEFAULT false,
  money_needed_by_month text,
  money_needed_by_skipped boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_money_dates_development_check CHECK (development_amount IS NULL OR development_amount >= 0),
  CONSTRAINT project_money_dates_filming_month_check
    CHECK (filming_start_month IS NULL OR filming_start_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT project_money_dates_needed_month_check
    CHECK (money_needed_by_month IS NULL OR money_needed_by_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT project_money_dates_filming_skip_check CHECK (NOT (filming_start_skipped AND filming_start_month IS NOT NULL)),
  CONSTRAINT project_money_dates_needed_skip_check CHECK (NOT (money_needed_by_skipped AND money_needed_by_month IS NOT NULL))
);
