-- Research question answers (DECISIONS.md › Admin follow-up and research).
-- Additive only: one new table, one answer per investor per question.
CREATE TABLE IF NOT EXISTS investor_research_answers (
  investor_id integer NOT NULL REFERENCES investors(id) ON DELETE CASCADE,
  question_key text NOT NULL,
  answer text NOT NULL,
  answered_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (investor_id, question_key),
  CONSTRAINT investor_research_answers_answer_check CHECK (answer IN ('yes', 'no', 'not_sure'))
);
