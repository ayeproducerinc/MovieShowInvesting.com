import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { getGetFilmmakerTrailerThumbnailUrl } from '@workspace/api-client-react';

type Preview = { status: 'checking' | 'processing' | 'ready' | 'unavailable' | 'none'; url?: string };

export function TrailerThumbnail() {
  const [preview, setPreview] = useState<Preview>({ status: 'checking' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let imageUrl: string | undefined;
    setPreview({ status: 'checking' });

    async function load() {
      try {
        const response = await fetch(getGetFilmmakerTrailerThumbnailUrl(), {
          credentials: 'include',
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (response.status === 404) {
          setPreview({ status: 'none' });
        } else if (response.status === 202) {
          setPreview({ status: 'processing' });
          timer = setTimeout(() => void load(), 10_000);
        } else if (response.ok && response.headers.get('content-type')?.startsWith('image/jpeg')) {
          imageUrl = URL.createObjectURL(await response.blob());
          if (controller.signal.aborted) {
            URL.revokeObjectURL(imageUrl);
            return;
          }
          setPreview({ status: 'ready', url: imageUrl });
        } else {
          setPreview({ status: 'unavailable' });
        }
      } catch {
        if (!controller.signal.aborted) setPreview({ status: 'unavailable' });
      }
    }

    void load();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [attempt]);

  if (preview.status === 'none') return null;
  if (preview.status === 'ready') {
    return <img src={preview.url} alt="Thumbnail from your uploaded trailer" className="dossier-media-preview" data-testid="img-trailer-thumbnail" />;
  }
  if (preview.status === 'unavailable') {
    return <p className="dossier-status" role="status" data-testid="status-trailer-thumbnail">Trailer thumbnail is unavailable right now. <button type="button" className="underline" onClick={() => setAttempt(value => value + 1)}><RotateCcw size={14} style={{ display: 'inline' }} /> Try again</button></p>;
  }
  return <p className="dossier-status" role="status" data-testid="status-trailer-thumbnail">{preview.status === 'processing' ? 'Bunny is preparing your trailer thumbnail. This preview will update when it’s ready.' : 'Checking your trailer thumbnail…'}</p>;
}