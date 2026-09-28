import { useEffect, useLayoutEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useAuth } from '@workspace/replit-auth-web';
import { useFirebaseSessionReady, useFirebaseUser } from '@/components/firebase-bootstrap';
import { canReplayPage, setPublicReplayEnabled, syncMixpanelAccount } from '@/lib/analytics';

const STORAGE_KEY = 'movie-show-investing:public-replay-consent';
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
  const replitAuth = useAuth();
  const firebaseUser = useFirebaseUser();
  const firebaseReady = useFirebaseSessionReady();
  const authReady = !replitAuth.isLoading && firebaseReady;
  const account = replitAuth.user
    ? `replit:${replitAuth.user.id}`
    : firebaseUser ? `firebase:${firebaseUser.uid}` : null;
  const [readyAccount, setReadyAccount] = useState<string | null | undefined>(undefined);

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
    return () => setPublicReplayEnabled(false);
  }, [account, authReady, readyAccount, choice, location]);

  function choose(value: Exclude<Choice, null>) {
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // The choice still applies to this tab if storage is unavailable.
    }
    setChoice(value);
    setOpen(false);
  }

  return <>
    <button type="button" className="text-left hover:text-[#dfb674]" onClick={() => setOpen(true)}>Replay preferences</button>
    {open && <div role="region" aria-label="Public-page replay preferences" className="fixed inset-x-4 bottom-4 z-[80] mx-auto max-w-[560px] border border-[#b9aea1] bg-[#f4f0e7] p-5 text-[#26303d] shadow-[0_18px_50px_rgba(17,25,30,.3)] sm:inset-x-6 sm:bottom-6 sm:p-6">
      <h2 className="serif text-[26px] leading-tight">Help improve the public pages?</h2>
      <p className="mt-3 text-sm leading-relaxed">With your permission, Mixpanel can replay visits to Home, Explore, and FAQ. All text and form inputs are masked; console and network activity are not recorded. Investor forms, filmmaker pages, messages, and account pages are excluded. If you sign in, replay may be linked to an opaque account ID.</p>
      <p className="mt-2 text-sm">You can change this choice here at any time. <Link href="/privacy" className="underline underline-offset-2">Read the privacy notice</Link>.</p>
      <div className="mt-5 flex flex-wrap gap-2">
        <button type="button" onClick={() => choose('allow')} className="min-h-10 bg-[#943c55] px-4 py-2 text-sm font-semibold text-white">Allow public-page replay</button>
        <button type="button" onClick={() => choose('decline')} className="min-h-10 border border-[#26303d] px-4 py-2 text-sm font-semibold">{choice === 'allow' ? 'Turn off replay' : 'No thanks'}</button>
        {choice !== null && <button type="button" onClick={() => setOpen(false)} className="min-h-10 px-3 py-2 text-sm underline">Close</button>}
      </div>
    </div>}
  </>;
}