import { useEffect, useLayoutEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useFirebaseSessionReady, useFirebaseUser } from '@/components/firebase-bootstrap';
import {
  canReplayPage,
  hasReplayProviderConfigured,
  isClarityDocumentActive,
  replayProviderNames,
  setClarityReplayConsent,
  setPublicReplayEnabled,
  syncMixpanelAccount,
} from '@/lib/analytics';

// A prior opt-in covered Mixpanel alone; introducing Clarity needs a new choice.
const STORAGE_KEY = 'movie-show-investing:public-replay-consent-v2';
type Choice = 'allow' | 'decline' | null;

function savedChoice(): Choice {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'allow' || value === 'decline' ? value : null;
  } catch {
    return null;
  }
}

export function ReplayConsent() {
  const [location] = useLocation();
  const [choice, setChoice] = useState<Choice>(savedChoice);
  const [open, setOpen] = useState(() => savedChoice() === null && canReplayPage(window.location.pathname));
  const firebaseUser = useFirebaseUser();
  const firebaseReady = useFirebaseSessionReady();
  const authReady = firebaseReady;
  const account = firebaseUser ? `firebase:${firebaseUser.uid}` : null;
  const [readyAccount, setReadyAccount] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (choice === null && canReplayPage(location)) setOpen(true);
    if (!canReplayPage(location)) setOpen(false);
  }, [choice, location]);

  useEffect(() => {
    if (!authReady) return;
    let active = true;
    void syncMixpanelAccount(account).then(success => {
      if (active && success) setReadyAccount(account);
    });
    return () => { active = false; };
  }, [account, authReady]);

  useLayoutEffect(() => {
    setPublicReplayEnabled(authReady && readyAccount === account && choice === 'allow' && canReplayPage(location));
    setClarityReplayConsent(choice === 'allow', location);
    return () => setPublicReplayEnabled(false);
  }, [account, authReady, readyAccount, choice, location]);

  useEffect(() => {
    function restoreConsent() {
      const currentChoice = savedChoice();
      if (currentChoice !== choice) setChoice(currentChoice);
      setPublicReplayEnabled(currentChoice === 'allow' && canReplayPage(window.location.pathname));
      setClarityReplayConsent(currentChoice === 'allow', window.location.pathname);
      if (currentChoice !== 'allow' && isClarityDocumentActive()) window.location.reload();
    }

    function syncStorage(event: StorageEvent) {
      if (event.key !== STORAGE_KEY && event.key !== null) return;
      const currentChoice = event.key === null ? null : event.newValue === 'allow' || event.newValue === 'decline' ? event.newValue : null;
      setChoice(currentChoice);
      if (currentChoice !== 'allow') {
        setPublicReplayEnabled(false);
        setClarityReplayConsent(false, window.location.pathname);
        if (isClarityDocumentActive()) window.location.reload();
      }
    }

    window.addEventListener('pageshow', restoreConsent);
    window.addEventListener('storage', syncStorage);
    return () => {
      window.removeEventListener('pageshow', restoreConsent);
      window.removeEventListener('storage', syncStorage);
    };
  }, [choice]);

  function choose(value: Exclude<Choice, null>) {
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // The choice still applies to this tab if storage is unavailable.
    }
    setChoice(value);
    setOpen(false);
    if (value === 'allow') {
      setClarityReplayConsent(true, location);
    } else {
      setPublicReplayEnabled(false);
      setClarityReplayConsent(false, location);
      if (isClarityDocumentActive()) window.location.reload();
    }
  }

  if (!hasReplayProviderConfigured()) return null;

  const providers = replayProviderNames();
  const providerLabel = providers.length > 1
    ? `${providers.slice(0, -1).join(', ')} and ${providers[providers.length - 1]}`
    : providers[0];
  return <>
    <button type="button" data-testid="button-replay-preferences" className="text-left hover:text-[#dfb674]" onClick={() => setOpen(true)}>Replay preferences</button>
    {open && canReplayPage(location) && <div role="region" aria-label="Public-page replay preferences" className="fixed inset-x-4 bottom-4 z-[80] mx-auto max-w-[560px] border border-[#b9aea1] bg-[#f4f0e7] p-5 text-[#26303d] shadow-[0_18px_50px_rgba(17,25,30,.3)] sm:inset-x-6 sm:bottom-6 sm:p-6">
      <h2 className="serif text-[26px] leading-tight">Help improve the public pages?</h2>
      <p className="mt-3 text-sm leading-relaxed">With your permission, {providerLabel} can replay visits to Home, Explore, and FAQ only. Investor, filmmaker, messaging, account, admin, and all other routes and forms are excluded. Text and form inputs are masked. {providers.includes('Mixpanel') && 'Mixpanel replay does not record console or network activity.'} {providers.includes('Microsoft Clarity') && 'Clarity loads only after permission on an approved public page; leaving those pages unloads its script before showing the next page.'}</p>
      {providers.includes('Mixpanel') && <p className="mt-2 text-sm leading-relaxed">If you sign in, Mixpanel replay may be associated with an opaque account ID. {providers.includes('Microsoft Clarity') && 'Clarity is not assigned that account ID.'}</p>}
      <p className="mt-2 text-sm">You can change this choice here at any time. <Link href="/privacy" className="underline underline-offset-2">Read the privacy notice</Link>.</p>
      <div className="mt-5 flex flex-wrap gap-2">
        <button type="button" data-testid="button-replay-allow" onClick={() => choose('allow')} className="min-h-10 bg-[#943c55] px-4 py-2 text-sm font-semibold text-white">Allow public-page replay</button>
        <button type="button" data-testid="button-replay-decline" onClick={() => choose('decline')} className="min-h-10 border border-[#26303d] px-4 py-2 text-sm font-semibold">{choice === 'allow' ? 'Turn off replay' : 'No thanks'}</button>
        {choice !== null && <button type="button" data-testid="button-replay-close" onClick={() => setOpen(false)} className="min-h-10 px-3 py-2 text-sm underline">Close</button>}
      </div>
    </div>}
  </>;
}