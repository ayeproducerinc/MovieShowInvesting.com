type InvestorEvent =
  | 'inv_page_view'
  | 'inv_complete'
  | 'inv_confirmed'
  | 'lineup_add'
  | 'inv_share_click';

type EventProperties = Record<string, string | number | boolean>;

type MixpanelClient = {
  track: (event: string, properties?: EventProperties) => void;
};

/**
 * Investor events only. The supplied Mixpanel snippet is initialized in the
 * document head with autocapture, automatic page views, and replay disabled.
 * Do not add private names, contact details, signatures, or allocation records.
 */
export function trackInvestorEvent(event: InvestorEvent, properties: EventProperties = {}) {
  if (!import.meta.env.VITE_MIXPANEL_TOKEN) return;
  const client = (window as Window & { mixpanel?: MixpanelClient }).mixpanel;
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