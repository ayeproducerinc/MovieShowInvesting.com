import type { ReactNode } from 'react';

export const NOT_PROVIDED = 'Not provided';

export function humanize(key: string) {
  return key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
}

function isEmpty(v: unknown) {
  return v == null || v === '' || (Array.isArray(v) && v.length === 0);
}

export function fmtDate(v: unknown) {
  if (typeof v !== 'string' || !v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
}

/** Recursively renders any JSON value; missing values are labelled, never hidden. */
export function ReadableValue({ value, depth = 0 }: { value: unknown; depth?: number }): ReactNode {
  if (isEmpty(value)) return <span className="admin-missing">{NOT_PROVIDED}</span>;
  if (typeof value === 'boolean') return <>{value ? 'Yes' : 'No'}</>;
  if (typeof value === 'number') return <>{value.toLocaleString()}</>;
  if (typeof value === 'string') {
    if (/^https?:\/\//i.test(value)) return <a href={value} target="_blank" rel="noopener noreferrer" className="break-all underline">{value}</a>;
    return <span className="whitespace-pre-wrap break-words">{value}</span>;
  }
  if (depth > 6) return <span className="admin-missing">Nested content too deep to display</span>;
  if (Array.isArray(value)) {
    return <ol className="admin-list">{value.map((item, i) => <li key={i}><ReadableValue value={item} depth={depth + 1} /></li>)}</ol>;
  }
  if (typeof value === 'object') {
    return <ReadableFields data={value as Record<string, unknown>} depth={depth + 1} />;
  }
  return <>{String(value)}</>;
}

export function ReadableFields({ data, depth = 0, labels = {}, skip = [] }: {
  data: Record<string, unknown>; depth?: number; labels?: Record<string, string>; skip?: string[];
}) {
  const entries = Object.entries(data).filter(([k]) => !skip.includes(k));
  if (!entries.length) return <span className="admin-missing">{NOT_PROVIDED}</span>;
  return <dl className={depth > 0 ? 'admin-nested' : 'grid gap-x-6 md:grid-cols-2'}>
    {entries.map(([k, v]) => <div key={k} className="border-b border-[#c8c0b5] py-3">
      <dt className="admin-mono text-xs uppercase tracking-wider">{labels[k] ?? humanize(k)}</dt>
      <dd className="mt-2"><ReadableValue value={v} depth={depth} /></dd>
    </div>)}
  </dl>;
}

export function Field({ label, children, missing }: { label: string; children?: ReactNode; missing?: boolean }) {
  return <div className="border-b border-[#c8c0b5] py-3">
    <dt className="admin-mono text-xs uppercase tracking-wider">{label}</dt>
    <dd className="mt-2 break-words">{missing || children == null || children === '' ? <span className="admin-missing">{NOT_PROVIDED}</span> : children}</dd>
  </div>;
}
