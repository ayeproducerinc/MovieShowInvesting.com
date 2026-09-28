type InvestorEvent =
  | 'inv_page_view'
  | 'inv_complete'
  | 'inv_confirmed'
  | 'lineup_add'
  | 'inv_share_click';

type EventProperties = Record<string, string | number | boolean>;

type MixpanelClient = {
  track: (event: string, properties?: EventProperties) => void;
  identify: (id: string) => void;
  reset: () => void;
  people: { set: (properties: EventProperties) => void };
  start_session_recording: () => void;
  stop_session_recording: () => void;
};

const publicReplayPages = new Set(['/', '/explore', '/faq']);
let lastAccount: string | null | undefined;
let identityRequest = 0;
let replayActive = false;
let replayWanted = false;

function mixpanel() {
  if (!import.meta.env.VITE_MIXPANEL_TOKEN || typeof window === 'undefined') return null;
  return (window as Window & { mixpanel?: MixpanelClient }).mixpanel ?? null;
}

export function canReplayPage(path: string) {
  return publicReplayPages.has(path);
}

export function setPublicReplayEnabled(enabled: boolean) {
  replayWanted = enabled;
  const client = mixpanel();
  if (!client || replayActive === enabled) return;
  try {
    if (enabled) client.start_session_recording();
    else client.stop_session_recording();
    replayActive = enabled;
  } catch (error) {
    console.warn('Mixpanel replay could not be updated.', error);
  }
}

/** Profile IDs are provider-scoped hashes, never email addresses or raw UIDs. */
export async function syncMixpanelAccount(account: string | null): Promise<boolean> {
  const client = mixpanel();
  if (!client) return false;
  if (lastAccount === account) return true;
  const request = ++identityRequest;
  try {
    if (replayActive) client.stop_session_recording();
    replayActive = false;
    client.reset();
    if (!account) {
      lastAccount = null;
      setPublicReplayEnabled(replayWanted);
      return true;
    }
    const bytes = new TextEncoder().encode(`movie-show-investing:${account}`);
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    if (request !== identityRequest) return false;
    const id = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
    client.identify(id);
    client.people.set({ 'Account status': 'Signed in' });
    lastAccount = account;
    setPublicReplayEnabled(replayWanted);
    return true;
  } catch (error) {
    if (request === identityRequest) lastAccount = undefined;
    console.warn('Mixpanel account identification could not be updated.', error);
    return false;
  }
}

/**
 * Investor events only. The supplied Mixpanel snippet is initialized in the
 * document head with autocapture and automatic page views disabled.
 * Do not add private names, contact details, signatures, or allocation records.
 */
export function trackInvestorEvent(event: InvestorEvent, properties: EventProperties = {}) {
  const client = mixpanel();
  if (!client) return;
  try {
    client.track(event, {
      ...properties,
      app_environment: import.meta.env.DEV ? 'development' : 'production',
    });
  } catch (error) {
    // Analytics must never change whether a saved or confirmed indication
    // succeeds, or whether a public project link can be shared.
    console.warn('Investor analytics event could not be sent.', error);
  }
}