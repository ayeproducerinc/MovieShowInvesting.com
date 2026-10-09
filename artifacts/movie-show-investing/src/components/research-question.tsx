import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetInvestorResearchQuestionQueryKey, useAnswerInvestorResearchQuestion, useGetInvestorResearchQuestion,
} from '@workspace/api-client-react';

const ANSWERS = [{ key: 'yes', label: 'Yes' }, { key: 'no', label: 'No' }, { key: 'not_sure', label: 'Not sure' }] as const;

/** One optional research question after signing (DECISIONS.md › Admin follow-up and research). */
export function ResearchQuestion({ identityId }: { identityId: string }) {
  const queryClient = useQueryClient();
  const queryKey = [...getGetInvestorResearchQuestionQueryKey(), identityId];
  const question = useGetInvestorResearchQuestion({ query: { queryKey, retry: false } });
  const answer = useAnswerInvestorResearchQuestion();
  const [failed, setFailed] = useState(false);
  if (!question.isSuccess || !question.data.can_answer) return null;
  async function choose(key: (typeof ANSWERS)[number]['key']) {
    setFailed(false);
    try {
      const saved = await answer.mutateAsync({ data: { answer: key } });
      queryClient.setQueryData(queryKey, saved);
    } catch { setFailed(true); }
  }
  return <section className="inv-section" data-testid="section-research-question" aria-label="Optional research question" style={{ overflowWrap: 'anywhere' }}>
    <p className="inv-kicker">One optional question</p>
    <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
      <legend style={{ fontWeight: 600, marginBottom: 10 }}>{question.data.question}</legend>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        {ANSWERS.map(option => <label key={option.key} className="inv-option" style={{ flex: '1 1 120px' }}>
          <input type="radio" name="research-answer" data-testid={`radio-research-${option.key}`} checked={question.data.answer === option.key}
            disabled={answer.isPending} onChange={() => void choose(option.key)} />
          <span>{option.label}</span>
        </label>)}
      </div>
    </fieldset>
    <p className="inv-small" data-testid="text-research-note">{question.data.note}</p>
    {question.data.answer && !failed && <p className="inv-small" role="status">Thanks. Your answer is saved; you can change it anytime.</p>}
    {failed && <p className="inv-small" role="alert">That didn’t save. Please try again.</p>}
  </section>;
}
