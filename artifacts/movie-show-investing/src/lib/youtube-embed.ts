/** Build a trusted player URL; never embed an arbitrary submitted URL. */
export function youtubeEmbedUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    let id: string | null = null;
    if (url.hostname === 'youtu.be') {
      id = url.pathname.match(/^\/([A-Za-z0-9_-]{11})\/?$/)?.[1] ?? null;
    } else if ([
      'youtube.com', 'www.youtube.com', 'm.youtube.com',
      'youtube-nocookie.com', 'www.youtube-nocookie.com',
    ].includes(url.hostname)) {
      id = url.pathname === '/watch'
        ? url.searchParams.get('v')
        : url.pathname.match(/^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})\/?$/)?.[1] ?? null;
    }
    return id && /^[A-Za-z0-9_-]{11}$/.test(id)
      ? `https://www.youtube-nocookie.com/embed/${id}?rel=0`
      : null;
  } catch {
    return null;
  }
}