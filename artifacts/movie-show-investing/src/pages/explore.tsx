import { useState } from 'react';
import { ArrowRight, RotateCcw } from 'lucide-react';
import { Link } from 'wouter';
import { getGetExploreQueryKey, useGetExplore } from '@workspace/api-client-react';
import type { GetExploreStage } from '@workspace/api-client-react';
import { useAuth } from '@workspace/replit-auth-web';
import { InvestorProjectCard } from '@/components/investor-project-card';
import { useFirebaseSessionReady, useFirebaseUser } from '@/components/firebase-bootstrap';
import '../investor.css';

const stages = [['','All stages'],['distribution','Distribution'],['production','Production'],['idea','Idea']] as const;
const genres = ['','Horror','Drama','Comedy','Thriller','Documentary','Sci-Fi','Other'];
const securitiesNotice = "Pledge your interest in future investment opportunities. If a project opens for investment, it will be offered only in compliance with securities laws, and you'll get full offering documents before you decide.";

export default function Explore() {
  const replitAuth = useAuth();
  const firebaseUser = useFirebaseUser();
  const firebaseReady = useFirebaseSessionReady();
  const identityKey = replitAuth.user ? `replit:${replitAuth.user.id}` : firebaseUser ? `firebase:${firebaseUser.uid}` : 'visitor';
  const authReady = !replitAuth.isLoading && firebaseReady;
  const [stage,setStage] = useState<GetExploreStage | ''>('');
  const [genre,setGenre] = useState('');
  const [search,setSearch] = useState('');
  const [sort,setSort] = useState('');
  const filters = { ...(stage ? {stage}:{}), ...(genre ? {genre}:{}), ...(search.trim() ? {search:search.trim()}:{}), ...(sort ? {sort}:{}) };
  const projects = useGetExplore(filters, { query: {
    queryKey: [...getGetExploreQueryKey(filters), identityKey],
    enabled: authReady,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  } });
  return <section className="inv">
    <div className="page-wrap"><div className="dossier-notice inv-securities-notice" role="note" data-testid="text-securities-notice">{securitiesNotice}</div><div className="inv-top"><span className="inv-kicker">Movie Show Investing / The collection</span><Link href="/invest" className="inv-kicker" data-testid="link-explore-invest">Express interest <ArrowRight size={13} className="inline"/></Link></div>
      <div className="inv-hero"><p className="inv-kicker">Independent stories / Open to discovery</p><h1>Find the stories<br/><em>worth following.</em></h1><p className="inv-lead">A collection of approved films and shows, at different points on their way to an audience. Look closer, ask questions, and decide what you believe in.</p></div>
    </div>
    <div className="inv-band"><div className="page-wrap inv-band-inner"><div><p className="inv-kicker" style={{color:'#d9b777'}}>A note before you browse</p><h2>Discovery first.<br/>Decisions later.</h2></div><p>These are project profiles, not investment offers. Expressing interest is non-binding, and no money is collected here. Returns aren’t guaranteed. You may get back less, or nothing.</p></div></div>
    <div className="page-wrap">
      <div className="inv-toolbar" data-clarity-mask="true">
        <div className="inv-field"><label htmlFor="explore-search">Search projects</label><input id="explore-search" className="inv-input" data-testid="input-explore-search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Title or story"/></div>
        <div className="inv-field"><label htmlFor="explore-stage">Stage</label><select id="explore-stage" className="inv-input" data-testid="select-explore-stage" value={stage} onChange={e=>setStage(e.target.value as GetExploreStage | '')}>{stages.map(([v,label])=><option value={v} key={v}>{label}</option>)}</select></div>
        <div className="inv-field"><label htmlFor="explore-genre">Genre</label><select id="explore-genre" className="inv-input" data-testid="select-explore-genre" value={genre} onChange={e=>setGenre(e.target.value)}>{genres.map(v=><option value={v} key={v}>{v || 'All genres'}</option>)}</select></div>
        <div className="inv-field"><label htmlFor="explore-sort">Order</label><select id="explore-sort" className="inv-input" data-testid="select-explore-sort" value={sort} onChange={e=>setSort(e.target.value)}><option value="">Recently added</option><option value="title">Title</option></select></div>
      </div>
      {!authReady || projects.isPending ? <div className="inv-projects" aria-label="Loading projects">{[1,2,3].map(i=><div key={i} className="inv-skeleton" style={{height:185}}/>)}</div> :
      projects.isError ? <div className="inv-state"><p className="inv-kicker">Connection interrupted</p><h1>The collection couldn’t load.</h1><p>Try again to see the latest approved projects.</p><button className="inv-button" data-testid="button-retry-explore" onClick={()=>void projects.refetch()}><RotateCcw size={16}/> Try again</button></div> :
      projects.data?.projects.length ? <div className="inv-projects">{projects.data.projects.map(project=><InvestorProjectCard key={project.id} project={project}/>)}</div> :
      <div className="inv-state"><p className="inv-kicker">Nothing in this frame</p><h1>No projects found.</h1><p>{stage || genre || search ? 'Try a different search or clear the filters.' : 'The collection is still taking shape. Check back when approved projects are ready.'}</p>{(stage || genre || search) && <button className="inv-button secondary" data-testid="button-clear-explore" onClick={()=>{setStage('');setGenre('');setSearch('');setSort('');}}>Clear filters</button>}</div>}
    </div>
  </section>;
}