import { useEffect, useState } from 'react';
import { MONTHS } from '@/lib/money-date';

const selectStyle = { minWidth: 0, flex: '1 1 120px', padding: '12px 14px', border: '1px solid #a9a194', borderRadius: 0, background: '#fbf8f1', font: '500 14px/1.5 var(--app-font-sans)' } as const;

/**
 * Optional month-and-year answer with "Skip for now" (DECISIONS.md › Money date).
 * value is "YYYY-MM" or ""; a skip clears the month and is stored separately.
 */
export function MonthYearField({ id, label, value, skipped, onChange }: {
  id: string; label: string; value: string; skipped: boolean;
  onChange: (next: { value: string; skipped: boolean }) => void;
}) {
  // A partly chosen date stays on screen until both month and year are picked.
  const [year, setYear] = useState(value ? value.slice(0, 4) : '');
  const [month, setMonth] = useState(value ? value.slice(5, 7) : '');
  useEffect(() => {
    if (value) { setYear(value.slice(0, 4)); setMonth(value.slice(5, 7)); }
    else if (skipped) { setYear(''); setMonth(''); }
  }, [value, skipped]);
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 11 }, (_, i) => String(thisYear - 1 + i));
  function choose(nextYear: string, nextMonth: string) {
    setYear(nextYear);
    setMonth(nextMonth);
    onChange({ value: nextYear && nextMonth ? `${nextYear}-${nextMonth}` : '', skipped: false });
  }
  return <fieldset style={{ border: 0, padding: 0, margin: '0 0 18px', minWidth: 0 }} data-testid={`field-${id}`}>
    <legend className="fm-label" style={{ marginBottom: 8 }}>{label} <span className="fm-small">· optional</span></legend>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, opacity: skipped ? 0.5 : 1 }}>
      <select aria-label={`${label} month`} id={`${id}-month`} data-testid={`select-${id}-month`} style={selectStyle} disabled={skipped}
        value={month} onChange={event => choose(year, event.target.value)}>
        <option value="">Month</option>
        {MONTHS.map((name, index) => <option key={name} value={String(index + 1).padStart(2, '0')}>{name}</option>)}
      </select>
      <select aria-label={`${label} year`} id={`${id}-year`} data-testid={`select-${id}-year`} style={selectStyle} disabled={skipped}
        value={year} onChange={event => choose(event.target.value, month)}>
        <option value="">Year</option>
        {years.map(option => <option key={option} value={option}>{option}</option>)}
      </select>
    </div>
    <label className="fm-check" style={{ marginTop: 10 }}>
      <input type="checkbox" data-testid={`checkbox-${id}-skip`} checked={skipped} onChange={event => onChange({ value: '', skipped: event.target.checked })} />
      <span>Skip for now</span>
    </label>
  </fieldset>;
}
