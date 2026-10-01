const HANDOFF_KEY = 'msi-filmmaker-auth-handoff';
const LINKED_DRAFT_KEY = 'msi-filmmaker-linked-drafts';
let activeProvider: FilmmakerAuthPreparationProvider | null = null;
let pendingPreparation: { draftId: number; promise: Promise<boolean> } | null = null;
let preparationSequence = 0;
const providerListeners = new Set<() => void>();

function notifyProviderListeners() {
  providerListeners.forEach(listener => listener());
}

export type FilmmakerAuthHandoff = {
  draftId: number;
  startedAt: number;
  prepared: boolean;
};
export type FilmmakerAuthPreparationProvider = {
  getDraftId: () => number | null;
  canPrepare: () => boolean;
  canSignInWithoutDraft: () => boolean;
  prepare: (draftId: number) => Promise<boolean>;
};

export function readFilmmakerAuthHandoff(): FilmmakerAuthHandoff | null {
  try {
    const value = sessionStorage.getItem(HANDOFF_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<FilmmakerAuthHandoff>;
    if (!Number.isSafeInteger(parsed.draftId) || Number(parsed.draftId) < 1
      || !Number.isFinite(parsed.startedAt) || Date.now() - Number(parsed.startedAt) > 30 * 60 * 1000) {
      sessionStorage.removeItem(HANDOFF_KEY);
      return null;
    }
    return {
      draftId: Number(parsed.draftId),
      startedAt: Number(parsed.startedAt),
      prepared: typeof parsed.prepared === 'boolean' ? parsed.prepared : true,
    };
  } catch {
    return null;
  }
}

export function prepareFilmmakerAuthHandoff(draftId: number): boolean {
  if (!Number.isSafeInteger(draftId) || draftId < 1) return false;
  try {
    sessionStorage.setItem(HANDOFF_KEY, JSON.stringify({ draftId, startedAt: Date.now(), prepared: true }));
    return true;
  } catch {
    return false;
  }
}

export function registerFilmmakerAuthPreparationProvider(provider: FilmmakerAuthPreparationProvider): () => void {
  activeProvider = provider;
  notifyProviderListeners();
  return () => {
    if (activeProvider === provider) {
      activeProvider = null;
      notifyProviderListeners();
    }
  };
}

export function subscribeFilmmakerAuthPreparation(listener: () => void): () => void {
  providerListeners.add(listener);
  return () => { providerListeners.delete(listener); };
}

export function canPrepareRegisteredFilmmakerHandoff(): boolean {
  return !activeProvider || activeProvider.canPrepare() || activeProvider.canSignInWithoutDraft();
}

/** Starts preparation synchronously, but leaves popup activation to the caller. */
export function prepareRegisteredFilmmakerHandoff(): Promise<boolean> | false | null {
  if (!activeProvider) return null;
  const provider = activeProvider;
  const draftId = provider.getDraftId();
  if (!Number.isSafeInteger(draftId) || !draftId || draftId < 1) {
    return provider.canSignInWithoutDraft() ? null : false;
  }
  try {
    sessionStorage.setItem(HANDOFF_KEY, JSON.stringify({ draftId, startedAt: Date.now(), prepared: false }));
  } catch {
    return false;
  }
  const sequence = ++preparationSequence;
  const promise = Promise.resolve().then(() => provider.prepare(draftId)).then(prepared => {
    if (sequence !== preparationSequence) return false;
    if (prepared) {
      try {
        sessionStorage.setItem(HANDOFF_KEY, JSON.stringify({ draftId, startedAt: Date.now(), prepared: true }));
      } catch {
        return false;
      }
    } else {
      try {
        sessionStorage.setItem(HANDOFF_KEY, JSON.stringify({ draftId, startedAt: Date.now(), prepared: false }));
      } catch { /* Keep the original pending marker if storage becomes unavailable. */ }
    }
    return prepared;
  }).catch(() => false);
  pendingPreparation = { draftId, promise };
  return promise;
}

export async function waitForFilmmakerAuthHandoff(draftId: number): Promise<boolean> {
  if (pendingPreparation?.draftId === draftId) return pendingPreparation.promise;
  const handoff = readFilmmakerAuthHandoff();
  return Boolean(handoff?.draftId === draftId && handoff.prepared);
}

export function clearFilmmakerAuthHandoff(): void {
  try {
    sessionStorage.removeItem(HANDOFF_KEY);
  } catch {
    // The server-side draft remains safe if browser storage is unavailable.
  }
  preparationSequence += 1;
  pendingPreparation = null;
}

function linkedDrafts(): Record<string, number[]> {
  try {
    const stored = sessionStorage.getItem(LINKED_DRAFT_KEY);
    if (!stored) return {};
    const parsed = JSON.parse(stored) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, number[]>
      : {};
  } catch {
    return {};
  }
}

export function isFilmmakerDraftLinked(ownerKey: string, draftId: number): boolean {
  return linkedDrafts()[ownerKey]?.includes(draftId) ?? false;
}

export function rememberFilmmakerDraftLinked(ownerKey: string, draftId: number): void {
  try {
    const drafts = linkedDrafts();
    const ownerDrafts = drafts[ownerKey] ?? [];
    if (!ownerDrafts.includes(draftId)) drafts[ownerKey] = [...ownerDrafts, draftId].slice(-20);
    sessionStorage.setItem(LINKED_DRAFT_KEY, JSON.stringify(drafts));
  } catch {
    // This is only a UI hint; the server verifies ownership on every write.
  }
}