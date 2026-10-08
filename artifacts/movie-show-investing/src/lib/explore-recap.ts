const fallback = 'View the project to discover more about this story.';

/** A display-only excerpt; never rewrites the filmmaker's saved logline. */
export function exploreStoryHook(logline?: string | null): string {
  const text = logline?.replace(/\s+/gu, ' ').trim();
  if (!text) return fallback;
  const sentence = typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter('en', { granularity: 'sentence' }).segment(text)[Symbol.iterator]().next().value?.segment.trim() || text
    : text.match(/^.*?[.!?]["”’')\]]*(?=\s|$)/u)?.[0] || text;
  const words = sentence.split(/\s+/u);
  return words.length > 30 ? `${words.slice(0, 30).join(' ').replace(/[,;:—-]+$/u, '')}…` : sentence;
}
