import { useEffect, useRef, useState, type MutableRefObject } from 'react';

type TurnstileApi = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const TURNSTILE_ACTION = 'filmmaker_submission';
let scriptPromise: Promise<void> | null = null;

function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = TURNSTILE_SCRIPT_URL;
      script.async = true;
      script.dataset.msiTurnstile = 'true';
      script.onload = () => window.turnstile ? resolve() : reject(new Error('Verification could not start.'));
      script.onerror = () => reject(new Error('Verification could not load.'));
      document.head.appendChild(script);
    }).catch(error => {
      scriptPromise = null;
      throw error;
    });
  }
  return scriptPromise;
}

export function FilmmakerTurnstile({
  siteKey,
  onToken,
  resetRef,
}: {
  siteKey: string;
  onToken: (token: string) => void;
  resetRef: MutableRefObject<(() => void) | null>;
}) {
  const element = useRef<HTMLDivElement>(null);
  const callback = useRef(onToken);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  callback.current = onToken;

  useEffect(() => {
    let mounted = true;
    let widgetId: string | null = null;
    void loadTurnstile().then(() => {
      if (!mounted || !element.current || !window.turnstile) return;
      widgetId = window.turnstile.render(element.current, {
        sitekey: siteKey,
        action: TURNSTILE_ACTION,
        theme: 'light',
        callback: (token: string) => {
          setError('');
          callback.current(token);
        },
        'expired-callback': () => {
          callback.current('');
          setError('Verification expired. Complete the challenge again before submitting.');
          if (widgetId && window.turnstile) window.turnstile.reset(widgetId);
        },
        'error-callback': () => {
          callback.current('');
          setError('Verification was interrupted. Try the challenge again.');
          if (widgetId && window.turnstile) window.turnstile.reset(widgetId);
        },
      });
      resetRef.current = () => {
        callback.current('');
        if (widgetId && window.turnstile) window.turnstile.reset(widgetId);
      };
    }).catch(() => {
      if (mounted) setError('Verification could not load. Check your connection and try again.');
    });

    return () => {
      mounted = false;
      callback.current('');
      resetRef.current = null;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [siteKey, resetRef, attempt]);

  return <div className="fm-section" data-testid="widget-filmmaker-turnstile">
    <p className="fm-label">Security check</p>
    <div ref={element} aria-label="Cloudflare verification" />
    <p className="fm-small" role="status">Complete the Cloudflare check to send your answers.</p>
    {error && <div className="fm-error" role="alert">{error} <button type="button" className="underline" onClick={() => {
      setError('');
      scriptPromise = null;
      setAttempt(value => value + 1);
    }}>Retry verification</button></div>}
  </div>;
}
