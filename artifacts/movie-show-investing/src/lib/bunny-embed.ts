/** Keep trusted Bunny embeds paused, preserving signed access parameters. */
export function bunnyEmbedUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
      || url.hostname !== 'iframe.mediadelivery.net' || !url.pathname.startsWith('/embed/')) {
      return null;
    }
    url.searchParams.set('autoplay', 'false');
    return url.href;
  } catch {
    return null;
  }
}