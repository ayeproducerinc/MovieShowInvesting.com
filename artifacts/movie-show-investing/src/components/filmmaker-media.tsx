import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { ArrowUpRight, Play, RotateCcw, UploadCloud, X } from 'lucide-react';
import {
  getUploadFilmmakerTrailerUrl,
  useGetFilmmakerMediaConfig,
  useUploadFilmmakerImage,
} from '@workspace/api-client-react';
import type { FilmmakerMediaConfig, FilmmakerResult, FilmmakerTrailerUpload } from '@workspace/api-client-react';
import { getInitializedAuth } from './firebase-bootstrap';

function safeMediaUrl(value: string | null) {
  if (!value) return null;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; }
  catch { return null; }
}

function TrailerPreview({ trailerUrl, posterUrl, title }: {
  trailerUrl: string | null; posterUrl: string | null; title: string | null;
}) {
  const [posterFailed, setPosterFailed] = useState(false);
  const trailer = safeMediaUrl(trailerUrl);
  const poster = safeMediaUrl(posterUrl);
  if (!trailer) return null;
  const showPoster = Boolean(poster && !posterFailed);
  return <div className="dossier-trailer-card" data-testid="card-trailer-preview">
    <span className="dossier-kicker">Your trailer</span>
    <a href={trailer} target="_blank" rel="noopener noreferrer" className="dossier-trailer-cover" aria-label={`Open trailer for ${title || 'your project'} in a new tab`} data-testid="link-trailer-preview">
      {showPoster
        ? <img src={poster || ''} alt="" onError={() => setPosterFailed(true)} data-testid="img-trailer-preview"/>
        : <span className="dossier-trailer-placeholder" data-testid="placeholder-trailer-preview"><small>Trailer available</small><strong>{title || 'Your project'}</strong><small>Open the video to watch</small></span>}
      <span className="dossier-trailer-play" aria-hidden="true"><Play size={24} fill="currentColor"/></span>
    </a>
    <p className="dossier-status">{showPoster ? 'Your poster is shown as the trailer preview.' : 'No poster needed — your video is ready to open.'}</p>
  </div>;
}

function ImageUploader({ kind, config, persistedUrl, projectId, onSaved }: {
  kind: 'poster' | 'share'; config: FilmmakerMediaConfig; persistedUrl: string | null; projectId: number | null; onSaved: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  // Orval defaults to image/jpeg for raw Blob requests. Override for PNG/WebP.
  const upload = useUploadFilmmakerImage({ request: { headers: {
    'Content-Type': file?.type || 'image/jpeg',
    ...(projectId ? { 'X-MSI-Project-Id': String(projectId) } : {}),
  } } });
  useEffect(() => {
    if (!file) { setPreview(''); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const label = kind === 'poster' ? 'Poster' : 'Share image';
  function select(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] || null;
    event.target.value = '';
    setError(''); setSuccess('');
    if (!selected) return;
    if (!config.image_types.includes(selected.type as FilmmakerMediaConfig['image_types'][number])) {
      setFile(null); setError(`Choose a ${config.image_types.map(type => type.split('/')[1].toUpperCase()).join(', ')} image.`); return;
    }
    if (selected.size === 0 || selected.size > config.image_max_bytes) {
      setFile(null); setError(`Choose an image under ${Math.round(config.image_max_bytes / 1048576)} MB.`); return;
    }
    setFile(selected);
  }
  async function save() {
    if (!file || upload.isPending) return;
    setError(''); setSuccess('');
    try {
      await upload.mutateAsync({ data: file, params: { kind } });
      setFile(null);
      setSuccess(`${label} uploaded. Your project is pending review again if it was previously approved.`);
      onSaved();
    } catch { setError(`${label} upload failed. Your existing image is unchanged. Please retry.`); }
  }
  return <div className="dossier-media-tile">
    <span className="dossier-kicker">{label}</span>
    <p className="dossier-status">{kind === 'poster' ? 'Artwork for your project page.' : 'Artwork for link previews. Keep financial figures off the image.'} {config.image_types.map(type => type.split('/')[1].toUpperCase()).join(', ')} · up to {Math.round(config.image_max_bytes / 1048576)} MB.</p>
    {(preview || safeMediaUrl(persistedUrl)) && <img className="dossier-media-preview" src={preview || safeMediaUrl(persistedUrl) || ''} alt={preview ? `Selected ${label.toLowerCase()} preview` : `Current ${label.toLowerCase()}`} data-testid={`img-${kind}-preview`} />}
    {safeMediaUrl(persistedUrl) && <a href={safeMediaUrl(persistedUrl) || undefined} target="_blank" rel="noopener noreferrer" className="dossier-media-link" data-testid={`link-current-${kind}`}>View current {label.toLowerCase()} <ArrowUpRight size={14} style={{ display: 'inline' }}/></a>}
    <label className="dossier-file-label" htmlFor={`media-${kind}`}>Choose {label.toLowerCase()}<input id={`media-${kind}`} data-testid={`input-${kind}-file`} type="file" accept={config.image_types.join(',')} onChange={select} disabled={upload.isPending}/></label>
    {file && <p className="dossier-status" data-testid={`text-${kind}-selected`}>{file.name} · {(file.size / 1048576).toFixed(1)} MB</p>}
    {error && <p className="dossier-error" role="alert" data-testid={`error-${kind}-upload`}>{error}</p>}
    {success && <p className="dossier-status" role="status" data-testid={`status-${kind}-upload`}>{success}</p>}
    {file && <div className="dossier-actions" style={{ marginTop: 15 }}><button type="button" className="dossier-button" data-testid={`button-upload-${kind}`} disabled={upload.isPending} onClick={() => void save()}><UploadCloud size={16}/> {upload.isPending ? 'Uploading…' : `Upload ${label.toLowerCase()}`}</button><button type="button" className="dossier-button dossier-button-outline" data-testid={`button-clear-${kind}`} disabled={upload.isPending} onClick={() => setFile(null)}>Clear selection</button></div>}
  </div>;
}

function TrailerUploader({ config, trailerUrl, projectId, onSaved }: {
  config: FilmmakerMediaConfig; trailerUrl: string | null; projectId: number | null; onSaved: () => void;
}) {
  // XHR is used only for the binary POST so upload progress and cancellation are available.
  // The path comes from the generated client; cookies are sent through the shared proxy.
  const active = useRef<XMLHttpRequest | null>(null);
  const run = useRef(0);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<'idle' | 'uploading' | 'finalizing' | 'complete' | 'error' | 'cancelled'>('idle');
  const [error, setError] = useState('');
  useEffect(() => () => { run.current += 1; active.current?.abort(); }, []);
  function select(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] || null;
    event.target.value = '';
    setError(''); setStatus('idle'); setProgress(0);
    if (!selected) return;
    if (!config.trailer_types.includes(selected.type as FilmmakerMediaConfig['trailer_types'][number])) {
      setFile(null); setError(`Choose a ${config.trailer_types.map(type => type.split('/')[1].toUpperCase()).join(', ')} video.`); return;
    }
    if (selected.size === 0 || selected.size > config.trailer_max_bytes) {
      setFile(null); setError(`Choose a video under ${Math.round(config.trailer_max_bytes / 1048576)} MB.`); return;
    }
    setFile(selected);
  }
  async function start() {
    if (!file || status === 'uploading' || status === 'finalizing') return;
    const attempt = ++run.current;
    setStatus('uploading'); setError(''); setProgress(0);
    try {
      const token = await getInitializedAuth()?.currentUser?.getIdToken();
      const xhr = new XMLHttpRequest();
      xhr.open('POST', getUploadFilmmakerTrailerUrl());
      xhr.withCredentials = true;
      xhr.responseType = 'json';
      xhr.setRequestHeader('Content-Type', file.type);
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      if (projectId) xhr.setRequestHeader('X-MSI-Project-Id', String(projectId));
      // Do not set Content-Length; the browser supplies it for the File body.
      xhr.upload.onprogress = event => {
        if (attempt === run.current && event.lengthComputable) setProgress(Math.round(event.loaded / event.total * 100));
      };
      xhr.upload.onload = () => { if (attempt === run.current) setStatus('finalizing'); };
      xhr.onerror = () => {
        if (attempt !== run.current) return;
        active.current = null; setStatus('error');
        setError('The upload was interrupted. Retry will send the entire file again.');
      };
      xhr.onload = () => {
        if (attempt !== run.current) return;
        active.current = null;
        let payload: FilmmakerTrailerUpload | null = null;
        try { payload = typeof xhr.response === 'string' ? JSON.parse(xhr.response) as FilmmakerTrailerUpload : xhr.response as FilmmakerTrailerUpload; }
        catch { /* An invalid response is not a confirmed upload. */ }
        if (xhr.status >= 200 && xhr.status < 300 && payload?.trailer_url && payload.video_id) {
          setStatus('complete'); setProgress(100); onSaved();
        } else {
          setStatus('error');
          setError(xhr.status === 413 ? 'This file exceeds the server limit of 500 MiB. Choose a smaller video.' : 'The server could not save this video. Retry will send the entire file again.');
        }
      };
      active.current = xhr;
      xhr.send(file);
    } catch {
      if (attempt === run.current) { active.current = null; setStatus('error'); setError('Could not start the upload. Please retry.'); }
    }
  }
  function cancel() {
    run.current += 1;
    active.current?.abort();
    active.current = null;
    setStatus('cancelled'); setProgress(0);
  }
  const busy = status === 'uploading' || status === 'finalizing';
  return <div className="dossier-media-tile">
    <span className="dossier-kicker">Trailer / direct video upload</span>
    <p className="dossier-status">MP4, WebM or MOV · up to {Math.round(config.trailer_max_bytes / 1048576)} MiB. Uploads are sent in one request and cannot be resumed. Replacing media sends an approved project back to review.</p>
    {safeMediaUrl(trailerUrl) && <a href={safeMediaUrl(trailerUrl) || undefined} target="_blank" rel="noopener noreferrer" className="dossier-media-link" data-testid="link-current-trailer">View current trailer <ArrowUpRight size={14} style={{ display: 'inline' }}/></a>}
    <label className="dossier-file-label" htmlFor="media-trailer">Choose video<input id="media-trailer" data-testid="input-trailer-file" type="file" accept={config.trailer_types.join(',')} disabled={busy} onChange={select}/></label>
    {file && <p className="dossier-status" data-testid="text-trailer-selected">{file.name} · {(file.size / 1048576).toFixed(1)} MB</p>}
    {busy && <div className="dossier-upload-progress"><div role="progressbar" aria-label="Trailer upload" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} style={{ width: `${progress}%` }}/></div>}
    <p className="dossier-status" role="status" data-testid="status-trailer-upload">{status === 'uploading' ? `Uploading video · ${progress}%` : status === 'finalizing' ? 'Upload sent. Waiting for the server to save it…' : status === 'complete' ? 'Video saved. Processing may take a moment before it appears on the project page.' : status === 'cancelled' ? 'Upload cancelled in your browser. If it had just finished, check the project page before retrying.' : ''}</p>
    {error && <p className="dossier-error" role="alert" data-testid="error-trailer-upload">{error}</p>}
    {file && <div className="dossier-actions" style={{ marginTop: 14 }}>
      {!busy && <button type="button" className="dossier-button" data-testid="button-upload-trailer" onClick={start}><UploadCloud size={16}/>{status === 'error' ? 'Retry full upload' : 'Upload trailer'}</button>}
      {busy && <button type="button" className="dossier-button dossier-button-outline" data-testid="button-cancel-trailer" onClick={cancel}><X size={16}/> Cancel upload</button>}
    </div>}
  </div>;
}

export function FilmmakerMedia({ result, onSaved }: { result: FilmmakerResult; onSaved: () => void }) {
  const config = useGetFilmmakerMediaConfig();
  return <section className="dossier-section" data-testid="section-filmmaker-media">
    <span className="dossier-kicker">Optional / project artwork</span><h2>Give it a first look.</h2>
    <p>These files are public on your link-accessible project page. Only upload media you have permission to share. Editing media resets showcase approval for another review; it does not open investing.</p>
    <TrailerPreview key={result.poster_url || 'no-poster'} trailerUrl={result.trailer_url} posterUrl={result.poster_url} title={result.title}/>
    {config.isLoading && <div aria-label="Checking media availability"><div className="dossier-skeleton" style={{ width: '75%' }}/><div className="dossier-skeleton" style={{ width: '55%' }}/></div>}
    {config.isError && <div className="dossier-notice">Media setup is unavailable right now. Your external trailer link above still works. <button type="button" className="underline" data-testid="button-retry-media-config" onClick={() => void config.refetch()}><RotateCcw size={14} style={{ display: 'inline' }}/> Check again</button></div>}
    {config.data && <div className="dossier-media-grid">
      {config.data.stream_available ? <TrailerUploader config={config.data} trailerUrl={result.trailer_url} projectId={result.project_id} onSaved={onSaved}/> : <div className="dossier-media-tile"><span className="dossier-kicker">Trailer upload unavailable</span><p className="dossier-status">Video uploads are not configured yet. You can still save an external trailer URL above.</p></div>}
      {config.data.storage_available ? <>
        <ImageUploader kind="poster" config={config.data} persistedUrl={result.poster_url} projectId={result.project_id} onSaved={onSaved}/>
        <ImageUploader kind="share" config={config.data} persistedUrl={result.share_image_url} projectId={result.project_id} onSaved={onSaved}/>
      </> : <div className="dossier-media-tile"><span className="dossier-kicker">Image upload unavailable</span><p className="dossier-status">Poster and share-image uploads are not configured yet.</p></div>}
    </div>}
  </section>;
}