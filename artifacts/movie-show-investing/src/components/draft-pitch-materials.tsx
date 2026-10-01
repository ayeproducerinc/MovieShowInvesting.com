import { forwardRef, useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { ArrowUpRight, Check, RotateCcw, UploadCloud, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetFilmmakerProjectsQueryKey,
  getGetFilmmakerResultQueryKey,
  updateFilmmakerDraftMaterials,
  updateFilmmakerProjectMaterials,
  useGetFilmmakerDraftMaterials,
  useGetFilmmakerMediaConfig,
  useGetFilmmakerProjectMaterials,
} from '@workspace/api-client-react';
import type { FilmmakerMediaConfig } from '@workspace/api-client-react';
import { customFetch } from '../../../../lib/api-client-react/src/custom-fetch';

export type PitchMaterialsSnapshot = {
  synopsis: string | null;
  trailer_url: string | null;
  poster_url: string | null;
  share_image_url: string | null;
  pitch_deck_url: string | null;
  pitch_deck_name: string | null;
};

export type DraftPitchMaterialsHandle = {
  /** Flushes the debounced synopsis/trailer save and rejects if persistence failed. */
  flush: () => Promise<void>;
};

export type DraftPitchMaterialsProps = {
  draftId: number | null;
  projectId?: number | null;
  onBusyChange?: (busy: boolean) => void;
  onErrorChange?: (error: string | null) => void;
};

type SectionKey = 'synopsis' | 'trailer' | 'pitchDeck' | 'poster' | 'share';
type SnapshotResponse = PitchMaterialsSnapshot;
type UploadKind = 'poster' | 'share' | 'trailer' | 'pitch-deck';

const EMPTY: PitchMaterialsSnapshot = {
  synopsis: null,
  trailer_url: null,
  poster_url: null,
  share_image_url: null,
  pitch_deck_url: null,
  pitch_deck_name: null,
};
const DECK_MAX_BYTES = 20 * 1024 * 1024;
const clean = (value: string) => value.trim() || null;

function routeBase(projectId: number | null | undefined) {
  return projectId ? '/api/filmmakers/project-materials' : '/api/filmmakers/draft-materials';
}

function requestHeaders(draftId: number | null, projectId: number | null | undefined): Record<string, string> {
  return projectId
    ? { 'X-MSI-Project-Id': String(projectId) }
    : draftId
      ? { 'X-MSI-Draft-Id': String(draftId) }
      : {};
}

function safeMediaUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value, window.location.origin);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

function protectedPdfPath(value: string) {
  const url = new URL(value, window.location.origin);
  if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) {
    throw new Error('The protected PDF URL is not an application API route.');
  }
  return `${url.pathname}${url.search}`;
}

export const DraftPitchMaterials = forwardRef<DraftPitchMaterialsHandle, DraftPitchMaterialsProps>(function DraftPitchMaterials(props, ref) {
  const { draftId, projectId, onBusyChange, onErrorChange } = props;
  const queryClient = useQueryClient();
  const ownerId = projectId ?? draftId;
  const ownerKey = `${projectId ? 'project' : 'draft'}:${ownerId ?? 'none'}`;
  const base = routeBase(projectId);
  const headers = requestHeaders(draftId, projectId);
  const queryOptions = {
    enabled: ownerId !== null,
    queryKey: ['filmmaker-pitch-materials', ownerKey],
    retry: false as const,
    refetchOnMount: 'always' as const,
  };
  const draftResource = useGetFilmmakerDraftMaterials({
    request: { headers },
    query: { ...queryOptions, enabled: ownerId !== null && projectId == null },
  });
  const projectResource = useGetFilmmakerProjectMaterials({
    request: { headers },
    query: { ...queryOptions, enabled: ownerId !== null && projectId != null },
  });
  const resource = projectId != null ? projectResource : draftResource;
  const mediaConfig = useGetFilmmakerMediaConfig();
  const [snapshot, setSnapshot] = useState<PitchMaterialsSnapshot>(EMPTY);
  const [expanded, setExpanded] = useState<Record<SectionKey, boolean>>({
    synopsis: false, trailer: false, pitchDeck: false, poster: false, share: false,
  });
  const [synopsis, setSynopsis] = useState('');
  const [trailer, setTrailer] = useState('');
  const [initializedOwner, setInitializedOwner] = useState('');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState('');
  const [saveStatus, setSaveStatus] = useState('');
  const [uploadStatus, setUploadStatus] = useState('');
  const [openingDeck, setOpeningDeck] = useState(false);
  const [deckViewError, setDeckViewError] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<Partial<Record<UploadKind, File>>>({});
  const [fileError, setFileError] = useState<Partial<Record<UploadKind, string>>>({});
  const [previewUrls, setPreviewUrls] = useState<Partial<Record<'poster' | 'share', string>>>({});
  const previewUrlsRef = useRef(previewUrls);
  const timer = useRef<number | null>(null);
  const latestText = useRef({ synopsis: '', trailer: '' });
  const savedText = useRef({ synopsis: '', trailer: '' });
  const pendingSave = useRef<Promise<void> | null>(null);
  const uploadInputRefs = useRef<Partial<Record<UploadKind, HTMLInputElement | null>>>({});

  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  useEffect(() => {
    onErrorChange?.(localError || (resource.isError ? 'Saved pitch materials could not be loaded; no edit has been saved.' : null));
  }, [localError, resource.isError, onErrorChange]);

  useEffect(() => {
    if (initializedOwner === ownerKey) return;
    if (!resource.data) return;
    const next = resource.data;
    setSnapshot(next);
    setSynopsis(next.synopsis ?? '');
    setTrailer(next.trailer_url ?? '');
    latestText.current = { synopsis: next.synopsis ?? '', trailer: next.trailer_url ?? '' };
    savedText.current = { ...latestText.current };
    setExpanded({
      synopsis: Boolean(next.synopsis),
      trailer: Boolean(next.trailer_url),
      pitchDeck: Boolean(next.pitch_deck_url),
      poster: Boolean(next.poster_url),
      share: Boolean(next.share_image_url),
    });
    setSelectedFiles({});
    setFileError({});
    setLocalError('');
    setSaveStatus('');
    setUploadStatus('');
    setInitializedOwner(ownerKey);
  }, [resource.data, initializedOwner, ownerKey]);

  useEffect(() => {
    if (initializedOwner && initializedOwner !== ownerKey) {
      setInitializedOwner('');
      setSnapshot(EMPTY);
      setSynopsis('');
      setTrailer('');
      setExpanded({ synopsis: false, trailer: false, pitchDeck: false, poster: false, share: false });
      latestText.current = { synopsis: '', trailer: '' };
      savedText.current = { synopsis: '', trailer: '' };
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, [ownerKey, initializedOwner]);

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    Object.values(previewUrlsRef.current).forEach(url => { if (url) URL.revokeObjectURL(url); });
  }, []);

  useEffect(() => {
    previewUrlsRef.current = previewUrls;
  }, [previewUrls]);

  const setError = useCallback((message: string) => {
    setLocalError(message);
    if (message) setSaveStatus('');
  }, []);

  const commitSnapshot = useCallback((next: PitchMaterialsSnapshot) => {
    setSnapshot(next);
    queryClient.setQueryData(['filmmaker-pitch-materials', ownerKey], next);
    if (projectId != null) {
      void queryClient.invalidateQueries({ queryKey: getGetFilmmakerResultQueryKey() });
      void queryClient.invalidateQueries({ queryKey: getGetFilmmakerProjectsQueryKey() });
    }
  }, [ownerKey, projectId, queryClient]);

  const performTextSave = useCallback(async (): Promise<void> => {
    if (pendingSave.current) {
      await pendingSave.current;
      if (latestText.current.synopsis !== savedText.current.synopsis || latestText.current.trailer !== savedText.current.trailer) {
        return performTextSave();
      }
      return;
    }
    const value = { ...latestText.current };
    const changedSynopsis = value.synopsis !== savedText.current.synopsis;
    const changedTrailer = value.trailer !== savedText.current.trailer;
    if (!changedSynopsis && !changedTrailer) return;
    setBusy(true);
    setError('');
    setSaveStatus('Saving your optional details…');
    const update = {
      ...(changedSynopsis ? { synopsis: clean(value.synopsis) } : {}),
      ...(changedTrailer ? { trailer_url: clean(value.trailer) } : {}),
    };
    const operation = (projectId != null
      ? updateFilmmakerProjectMaterials(update, { headers })
      : updateFilmmakerDraftMaterials(update, { headers })).then(next => {
      commitSnapshot(next);
      savedText.current = {
        synopsis: changedSynopsis ? value.synopsis : savedText.current.synopsis,
        trailer: changedTrailer ? value.trailer : savedText.current.trailer,
      };
      setSaveStatus(changedSynopsis && changedTrailer ? 'Synopsis and trailer details saved.' : changedSynopsis ? 'Synopsis saved.' : 'Trailer link saved.');
    }).catch(() => {
      setError('Your optional details could not be saved. Your text remains here; retry or wait for the next save attempt.');
      throw new Error('Pitch materials could not be saved.');
    }).finally(() => {
      pendingSave.current = null;
      setBusy(false);
    });
    pendingSave.current = operation;
    await operation;
    if (latestText.current.synopsis !== savedText.current.synopsis || latestText.current.trailer !== savedText.current.trailer) {
      return performTextSave();
    }
  }, [base, headers, projectId, setError, commitSnapshot]);

  const flush = useCallback(async () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    await pendingSave.current;
    if (latestText.current.synopsis !== savedText.current.synopsis || latestText.current.trailer !== savedText.current.trailer) {
      await performTextSave();
    }
  }, [performTextSave]);

  useEffect(() => {
    if (typeof ref === 'function') ref({ flush });
    else if (ref) ref.current = { flush };
  }, [flush, ref]);

  function updateText(field: 'synopsis' | 'trailer', value: string) {
    if (field === 'synopsis') setSynopsis(value);
    else setTrailer(value);
    latestText.current = { ...latestText.current, [field]: value };
    setLocalError('');
    setSaveStatus('');
    setUploadStatus('');
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      void performTextSave().catch(() => undefined);
    }, 750);
  }

  function toggle(key: SectionKey, checked: boolean) {
    setExpanded(current => ({ ...current, [key]: checked }));
  }

  function selectFile(kind: UploadKind, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = '';
    setFileError(current => ({ ...current, [kind]: undefined }));
    if (!file) return;
    let supported = true;
    let maxBytes = 0;
    let label: string = kind;
    if (kind === 'pitch-deck') {
      supported = file.type === 'application/pdf';
      maxBytes = DECK_MAX_BYTES;
      label = 'pitch deck';
    } else if (kind === 'trailer') {
      const config = mediaConfig.data;
      supported = Boolean(config?.trailer_types.includes(file.type as FilmmakerMediaConfig['trailer_types'][number]));
      maxBytes = config?.trailer_max_bytes ?? 0;
      label = 'video';
    } else {
      const config = mediaConfig.data;
      supported = Boolean(config?.image_types.includes(file.type as FilmmakerMediaConfig['image_types'][number]));
      maxBytes = config?.image_max_bytes ?? 0;
      label = kind === 'poster' ? 'poster image' : 'share image';
    }
    if (!supported) {
      setSelectedFiles(current => ({ ...current, [kind]: undefined }));
      setFileError(current => ({ ...current, [kind]: kind === 'pitch-deck' ? 'Choose a PDF file.' : mediaConfig.isError ? 'Upload requirements could not be checked. Try again before choosing a file.' : 'This file type is not supported.' }));
      return;
    }
    if (file.size < 1 || file.size > maxBytes) {
      const limit = kind === 'pitch-deck' ? '20 MB' : `${Math.max(1, Math.round(maxBytes / 1048576))} MB`;
      setSelectedFiles(current => ({ ...current, [kind]: undefined }));
      setFileError(current => ({ ...current, [kind]: `Choose a ${label} no larger than ${limit}.` }));
      return;
    }
    setSelectedFiles(current => ({ ...current, [kind]: file }));
    if (kind === 'poster' || kind === 'share') {
      const preview = URL.createObjectURL(file);
      setPreviewUrls(current => {
        const old = current[kind];
        if (old) URL.revokeObjectURL(old);
        return { ...current, [kind]: preview };
      });
    }
  }

  async function upload(kind: UploadKind) {
    const file = selectedFiles[kind];
    if (!file || busy) return;
    if (kind === 'trailer' && !mediaConfig.data?.stream_available) {
      setError('Video upload is not available right now. Your external trailer link can still be saved.');
      return;
    }
    if ((kind === 'poster' || kind === 'share') && !mediaConfig.data?.storage_available) {
      setError('Image upload is not available right now.');
      return;
    }
    try {
      await flush();
    } catch {
      return;
    }
    setBusy(true);
    setError('');
    setUploadStatus(`Uploading ${kind === 'pitch-deck' ? 'pitch deck' : kind === 'trailer' ? 'trailer' : kind}…`);
    try {
      const path = kind === 'poster' || kind === 'share'
        ? `${base}/images?kind=${kind}`
        : `${base}/${kind}`;
      const next = await customFetch<SnapshotResponse>(path, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': file.type,
          'X-MSI-Filename': encodeURIComponent(file.name),
        },
        body: file,
      });
      commitSnapshot(next);
      setSelectedFiles(current => ({ ...current, [kind]: undefined }));
      if (kind === 'pitch-deck') setExpanded(current => ({ ...current, pitchDeck: true }));
      if (kind === 'trailer') {
        setTrailer(next.trailer_url ?? '');
        latestText.current = { ...latestText.current, trailer: next.trailer_url ?? '' };
        savedText.current = { ...savedText.current, trailer: next.trailer_url ?? '' };
      }
      setUploadStatus(`${kind === 'pitch-deck' ? 'Pitch deck' : kind === 'trailer' ? 'Trailer' : kind === 'poster' ? 'Poster' : 'Share image'} saved.`);
      setSaveStatus('');
    } catch (error) {
      const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 0;
      const noun = kind === 'pitch-deck' ? 'pitch deck' : kind === 'trailer' ? 'trailer' : kind === 'poster' ? 'poster' : 'share image';
      setError(status === 413 ? `The server rejected this ${noun} because it exceeds the allowed size. Your existing file is unchanged.` : `The ${noun} could not be saved. Your existing file is unchanged; please try again.`);
      setUploadStatus('');
    } finally {
      setBusy(false);
    }
  }

  async function remove(kind: UploadKind) {
    if (busy || !window.confirm(`Remove the saved ${kind === 'pitch-deck' ? 'pitch deck' : kind === 'share' ? 'share image' : kind}? This cannot be undone.`)) return;
    try {
      await flush();
    } catch {
      return;
    }
    setBusy(true);
    setError('');
    setUploadStatus('');
    try {
      const next = await customFetch<SnapshotResponse>(`${base}/${kind}`, {
        method: 'DELETE',
        headers,
      });
      commitSnapshot(next);
      setUploadStatus(`${kind === 'pitch-deck' ? 'Pitch deck' : kind === 'trailer' ? 'Trailer' : kind === 'poster' ? 'Poster' : 'Share image'} removed.`);
      if (kind === 'trailer') {
        setTrailer(next.trailer_url ?? '');
        latestText.current = { ...latestText.current, trailer: next.trailer_url ?? '' };
        savedText.current = { ...savedText.current, trailer: next.trailer_url ?? '' };
      }
    } catch {
      setError(`The saved ${kind === 'pitch-deck' ? 'pitch deck' : kind === 'share' ? 'share image' : kind} could not be removed. Nothing was changed.`);
    } finally {
      setBusy(false);
    }
  }

  async function viewSavedDeck(url: string) {
    if (openingDeck) return;
    setDeckViewError('');
    const tab = window.open('about:blank', '_blank');
    if (!tab) {
      setDeckViewError('Your browser blocked the pitch deck tab. Allow pop-ups for this site and try again.');
      return;
    }
    setOpeningDeck(true);
    tab.document.title = 'Loading protected pitch deck…';
    try {
      const blob = await customFetch<Blob>(protectedPdfPath(url), { responseType: 'blob' });
      if (!blob.size) throw new Error('The pitch deck response was empty.');
      const objectUrl = URL.createObjectURL(blob);
      tab.location.href = objectUrl;
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 5 * 60_000);
    } catch {
      tab.close();
      setDeckViewError('This saved pitch deck could not be opened. Your sign-in may have expired; retry after checking your connection.');
    } finally {
      setOpeningDeck(false);
    }
  }

  function fileControl(kind: UploadKind, label: string, accept: string, savedUrl: string | null, displayName?: string | null) {
    const url = safeMediaUrl(savedUrl);
    const file = selectedFiles[kind];
    const selectedPreview = kind === 'poster' || kind === 'share' ? previewUrls[kind] : undefined;
    const name = displayName || (kind === 'pitch-deck' ? 'Saved PDF' : 'Saved file');
    return <div className="dossier-media-tile" data-testid={`panel-pitch-material-${kind}`}>
      <span className="dossier-kicker">{label}</span>
      {url && <p className="dossier-status" role="status">{kind === 'pitch-deck' ? name : `Saved to this ${projectId ? 'project' : 'draft'}.`} Unchecking the section only hides it; it does not remove the saved file.</p>}
      {url && kind !== 'pitch-deck' && (kind === 'poster' || kind === 'share') && <img className="dossier-media-preview" src={url} alt={`Saved ${label.toLowerCase()}`} data-testid={`img-saved-${kind}`}/>}
      {file && selectedPreview && <img className="dossier-media-preview" src={selectedPreview} alt={`Selected ${label.toLowerCase()} preview`} data-testid={`img-selected-${kind}`}/>}
      {url && kind === 'pitch-deck' && <button type="button" className="dossier-button dossier-button-outline" data-testid="button-view-saved-pitch-deck" disabled={openingDeck} onClick={() => void viewSavedDeck(savedUrl || '')}>{openingDeck ? 'Loading protected PDF…' : 'View current pitch deck'} <ArrowUpRight size={14}/></button>}
      {url && kind !== 'pitch-deck' && <a href={url} target="_blank" rel="noopener noreferrer" className="dossier-media-link" data-testid={`link-saved-${kind}`}>View current {label.toLowerCase()} <ArrowUpRight size={14} style={{ display: 'inline' }}/></a>}
      {kind === 'pitch-deck' && deckViewError && <p className="dossier-error" role="alert" data-testid="error-view-saved-pitch-deck">{deckViewError}</p>}
      {url && <button type="button" className="dossier-button dossier-button-outline" data-testid={`button-remove-${kind}`} disabled={busy} onClick={() => void remove(kind)}>Remove {label.toLowerCase()}</button>}
      <label className="dossier-file-label" htmlFor={`pitch-material-${kind}`}>Choose {label.toLowerCase()}
        <input
          id={`pitch-material-${kind}`}
          ref={element => { uploadInputRefs.current[kind] = element; }}
          data-testid={`input-pitch-material-${kind}`}
          type="file"
          accept={accept}
          disabled={busy || mediaConfig.isLoading && kind !== 'pitch-deck'}
          onChange={event => selectFile(kind, event)}
        />
      </label>
      {file && <p className="dossier-status" data-testid={`text-selected-${kind}`}>{file.name} · {(file.size / 1048576).toFixed(1)} MB</p>}
      {fileError[kind] && <p className="dossier-error" role="alert" data-testid={`error-file-${kind}`}>{fileError[kind]}</p>}
      {file && <div className="dossier-actions" style={{ marginTop: 14 }}>
        <button type="button" className="dossier-button" data-testid={`button-upload-${kind}`} disabled={busy} onClick={() => void upload(kind)}><UploadCloud size={16}/>{busy ? 'Saving…' : `Save ${label.toLowerCase()}`}</button>
        <button type="button" className="dossier-button dossier-button-outline" data-testid={`button-clear-${kind}`} disabled={busy} onClick={() => setSelectedFiles(current => ({ ...current, [kind]: undefined }))}><X size={15}/> Clear selection</button>
      </div>}
    </div>;
  }

  const ready = ownerId !== null && initializedOwner === ownerKey;
  if (ownerId === null) return <section className="dossier-section" data-testid="section-pitch-materials"><p className="dossier-notice" role="status">Pitch materials will be available after this worksheet has a saved draft or selected project. Nothing has been saved here.</p></section>;
  if (resource.isError) return <section className="dossier-section" data-testid="section-pitch-materials">
    <span className="dossier-kicker">Optional / strengthen your pitch</span>
    <div className="dossier-notice" role="alert">Saved pitch materials could not be loaded. Editing is paused so existing files cannot be overwritten or shown as saved. <button type="button" className="underline" data-testid="button-retry-pitch-materials" onClick={() => void resource.refetch()}><RotateCcw size={14} style={{ display: 'inline' }}/> Try again</button></div>
  </section>;
  if (resource.isPending || !ready) return <section className="dossier-section" data-testid="section-pitch-materials" aria-label="Loading pitch materials"><p className="dossier-kicker">Optional / strengthen your pitch</p><div className="dossier-skeleton" style={{ width: '75%' }}/><div className="dossier-skeleton" style={{ width: '55%' }}/></section>;

  const synopsisSaved = Boolean(snapshot.synopsis);
  const trailerSaved = Boolean(snapshot.trailer_url);
  const hasDeck = Boolean(snapshot.pitch_deck_url);
  const textDirty = latestText.current.synopsis !== savedText.current.synopsis || latestText.current.trailer !== savedText.current.trailer;
  return <section className="dossier-section" data-testid="section-pitch-materials">
    <span className="dossier-kicker">Optional / pitch materials</span>
    <h2>To create a stronger pitch, add any pitch trailers, a synopsis, a pitch deck, posters, or other pitch images you have.</h2>
    <p>These are optional. Your materials are saved to this {projectId ? 'project' : 'draft'} and can be changed or removed later. Editing approved listing materials may return the project to review.</p>
    <p className="dossier-status">Unchecking a box only hides its controls; it never deletes saved material. Clear synopsis text to remove it, or use a file’s explicit Remove action.</p>
    <div className="dossier-notice" role="note" data-testid="text-pitch-deck-disclosure"><strong>Pitch deck visibility:</strong> If your pitch is approved for listing, its pitch deck will be publicly viewable from Explore. Do not include confidential or personal information. Public downloads cannot be recalled, even if you later remove the deck.</div>

    {mediaConfig.isError && <div className="dossier-notice" role="status">Media upload requirements are temporarily unavailable. You can still save synopsis and trailer links. <button type="button" className="underline" data-testid="button-retry-material-config" onClick={() => void mediaConfig.refetch()}><RotateCcw size={14} style={{ display: 'inline' }}/> Check again</button></div>}

    <div className="dossier-field">
      <label className="flex items-start gap-3" htmlFor="pitch-has-synopsis">
        <input id="pitch-has-synopsis" type="checkbox" data-testid="checkbox-has-synopsis" checked={expanded.synopsis} onChange={event => toggle('synopsis', event.target.checked)}/>
        <span>Do you have a synopsis?</span>
      </label>
      {expanded.synopsis && <div style={{ marginTop: 15 }}>
        <label htmlFor="pitch-synopsis">Synopsis <small>· optional, up to 5,000 characters</small></label>
        <textarea id="pitch-synopsis" data-testid="input-pitch-synopsis" maxLength={5000} value={synopsis} onChange={event => updateText('synopsis', event.target.value)} placeholder="The story beyond the logline"/>
        {synopsisSaved && <p className="dossier-status" role="status">Synopsis saved. Unchecking this box hides it here; it does not delete it.</p>}
      </div>}
    </div>

    <div className="dossier-field">
      <label className="flex items-start gap-3" htmlFor="pitch-has-trailer">
        <input id="pitch-has-trailer" type="checkbox" data-testid="checkbox-has-trailer" checked={expanded.trailer} onChange={event => toggle('trailer', event.target.checked)}/>
        <span>Do you have a pitch trailer?</span>
      </label>
      {expanded.trailer && <div style={{ marginTop: 15 }}>
        <label htmlFor="pitch-trailer-url">External trailer URL <small>· optional; full http:// or https:// link</small></label>
        <input id="pitch-trailer-url" data-testid="input-pitch-trailer-url" type="url" maxLength={2048} value={trailer} onChange={event => updateText('trailer', event.target.value)} placeholder="https://"/>
        {trailerSaved && <p className="dossier-status" role="status">Trailer saved. Unchecking this box hides it here; it does not delete it.</p>}
        {mediaConfig.data?.stream_available && <>
          <p className="dossier-status">Or upload a video: {mediaConfig.data.trailer_types.map(type => type.split('/')[1].toUpperCase()).join(', ')} · up to {Math.round(mediaConfig.data.trailer_max_bytes / 1048576)} MB. Replacing an uploaded trailer will replace the current video.</p>
          {fileControl('trailer', 'Trailer video', mediaConfig.data.trailer_types.join(','), snapshot.trailer_url)}
        </>}
        {mediaConfig.data && !mediaConfig.data.stream_available && <p className="dossier-status">Direct video upload is not configured. You can still save an external trailer link.</p>}
      </div>}
    </div>

    <div className="dossier-field">
      <label className="flex items-start gap-3" htmlFor="pitch-has-deck">
        <input id="pitch-has-deck" type="checkbox" data-testid="checkbox-has-pitch-deck" checked={expanded.pitchDeck} onChange={event => toggle('pitchDeck', event.target.checked)}/>
        <span>Do you have a pitch deck?</span>
      </label>
      {expanded.pitchDeck && <div style={{ marginTop: 15 }}>
        <p className="dossier-status">One PDF · up to 20 MB. This deck may be publicly viewable from Explore if the pitch is approved for listing. Please keep confidential or personal information out of it.</p>
        {fileControl('pitch-deck', 'Pitch deck (PDF)', 'application/pdf,.pdf', snapshot.pitch_deck_url, snapshot.pitch_deck_name)}
      </div>}
    </div>

    <div className="dossier-field">
      <label className="flex items-start gap-3" htmlFor="pitch-has-poster">
        <input id="pitch-has-poster" type="checkbox" data-testid="checkbox-has-poster" checked={expanded.poster} onChange={event => toggle('poster', event.target.checked)}/>
        <span>Do you have a poster?</span>
      </label>
      {expanded.poster && <div style={{ marginTop: 15 }}>
        <p className="dossier-status">Artwork for your project page. {mediaConfig.data?.image_types.map(type => type.split('/')[1].toUpperCase()).join(', ') || 'JPEG, PNG or WebP'} · up to {mediaConfig.data ? Math.round(mediaConfig.data.image_max_bytes / 1048576) : 'server limit'} MB.</p>
        {fileControl('poster', 'Poster', mediaConfig.data?.image_types.join(',') ?? 'image/jpeg,image/png,image/webp', snapshot.poster_url)}
      </div>}
    </div>

    <div className="dossier-field">
      <label className="flex items-start gap-3" htmlFor="pitch-has-share-image">
        <input id="pitch-has-share-image" type="checkbox" data-testid="checkbox-has-share-image" checked={expanded.share} onChange={event => toggle('share', event.target.checked)}/>
        <span>Do you have a share image?</span>
      </label>
      {expanded.share && <div style={{ marginTop: 15 }}>
        <p className="dossier-status">Artwork for link previews. Keep financial figures off the image. {mediaConfig.data?.image_types.map(type => type.split('/')[1].toUpperCase()).join(', ') || 'JPEG, PNG or WebP'} · up to {mediaConfig.data ? Math.round(mediaConfig.data.image_max_bytes / 1048576) : 'server limit'} MB.</p>
        {fileControl('share', 'Share image', mediaConfig.data?.image_types.join(',') ?? 'image/jpeg,image/png,image/webp', snapshot.share_image_url)}
      </div>}
    </div>

    {busy && <p className="dossier-status" role="status" data-testid="status-material-saving"><span className="inline-block animate-spin align-middle"><RotateCcw size={14}/></span> {uploadStatus || saveStatus || 'Saving pitch materials…'}</p>}
    {!busy && (saveStatus || uploadStatus) && <p className="dossier-notice" role="status" data-testid="status-material-saved"><Check size={15} style={{ display: 'inline', marginRight: 6 }}/>{uploadStatus || saveStatus}</p>}
    {localError && <div className="dossier-error" role="alert" data-testid="error-pitch-materials"><p>{localError}</p>{textDirty && <button type="button" className="underline" data-testid="button-retry-text-save" disabled={busy} onClick={() => void flush().catch(() => undefined)}>Retry saving text</button>}</div>}
    {hasDeck && !expanded.pitchDeck && <p className="dossier-status">A pitch deck is saved. Unchecking the section only hides it; it does not remove the file.</p>}
  </section>;
});

export default DraftPitchMaterials;