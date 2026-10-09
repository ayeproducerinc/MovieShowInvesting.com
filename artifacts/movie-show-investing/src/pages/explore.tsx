import { useState } from 'react';
import { ArrowRight, RotateCcw } from 'lucide-react';
import { Link } from 'wouter';
import { getGetExploreQueryKey, useGetExplore } from '@workspace/api-client-react';
import type { ExploreProject, GetExploreStage } from '@workspace/api-client-react';
import { InvestorProjectCard } from '@/components/investor-project-card';
import { useFirebaseSessionReady, useFirebaseUser } from '@/components/firebase-bootstrap';
import '../investor.css';
import './explore.css';

const stages = [['','All stages'],['distribution','Distribution'],['production','Production'],['idea','Idea']] as const;
const genres = ['','Horror','Drama','Comedy','Thriller','Documentary','Sci-Fi','Romance','Action','Animation','Other'];
const securitiesNotice = "Project profiles are not investment offers. Expressing interest is non-binding, and no money is collected here. If an investment opportunity opens, full offering documents will be available before you decide. Returns aren’t guaranteed.";
type ExploreProjectWithPitchDeck = ExploreProject & { pitch_deck_url?: string | null; pitch_deck_name?: string | null };

export default function Explore() {
  const firebaseUser = useFirebaseUser();
  const firebaseReady = useFirebaseSessionReady();
  const identityKey = firebaseUser ? `firebase:${firebaseUser.uid}` : 'visitor';
  const authReady = firebaseReady;
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
  return <section className="inv inv-explore">
    <div className="page-wrap">
      <header className="explore-masthead">
        <h1>Find the stories <em>worth investing.</em></h1>
        <p className="explore-disclosure" role="note" data-testid="text-securities-notice">{securitiesNotice}</p>
      </header>
      <div className="explore-browse">
        <a href="#explore-projects" data-testid="link-browse-projects">↓ Scroll to explore approved projects</a>
        <Link href="/invest" data-testid="link-explore-invest">Express interest <ArrowRight size={13}/></Link>
      </div>
    </div>
    <div className="page-wrap">
      <div className="inv-toolbar" data-clarity-mask="true">
        <div className="inv-field"><label htmlFor="explore-search">Search projects</label><input id="explore-search" className="inv-input" data-testid="input-explore-search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Title or story"/></div>
        <div className="inv-field"><label htmlFor="explore-stage">Stage</label><select id="explore-stage" className="inv-input" data-testid="select-explore-stage" value={stage} onChange={e=>setStage(e.target.value as GetExploreStage | '')}>{stages.map(([v,label])=><option value={v} key={v}>{label}</option>)}</select></div>
        <div className="inv-field"><label htmlFor="explore-genre">Genre</label><select id="explore-genre" className="inv-input" data-testid="select-explore-genre" value={genre} onChange={e=>setGenre(e.target.value)}>{genres.map(v=><option value={v} key={v}>{v || 'All genres'}</option>)}</select></div>
        <div className="inv-field"><label htmlFor="explore-sort">Order</label><select id="explore-sort" className="inv-input" data-testid="select-explore-sort" value={sort} onChange={e=>setSort(e.target.value)}><option value="">Recently added</option><option value="title">Title</option></select></div>
      </div>
      <div className="explore-results" id="explore-projects">
      <h2 className="explore-results-title">Approved projects</h2>
      {!authReady || projects.isPending ? <div className="inv-projects" aria-label="Loading projects">{[1,2,3].map(i=><div key={i} className="inv-skeleton" style={{height:185}}/>)}</div> :
      projects.isError ? <div className="inv-state"><p className="inv-kicker">Connection interrupted</p><h1>The collection couldn’t load.</h1><p>Try again to see the latest approved projects.</p><button className="inv-button" data-testid="button-retry-explore" onClick={()=>void projects.refetch()}><RotateCcw size={16}/> Try again</button></div> :
       projects.data?.projects.length ? <div className="inv-projects">{projects.data.projects.map(project=><InvestorProjectCard key={project.id} project={project as ExploreProjectWithPitchDeck} variant="explore"/>)}</div> :
      <div className="inv-state"><p className="inv-kicker">Nothing in this frame</p><h1>No projects found.</h1><p>{stage || genre || search ? 'Try a different search or clear the filters.' : 'The collection is still taking shape. Check back when approved projects are ready.'}</p>{(stage || genre || search) && <button className="inv-button secondary" data-testid="button-clear-explore" onClick={()=>{setStage('');setGenre('');setSearch('');setSort('');}}>Clear filters</button>}</div>}
      </div>
    </div>
  </section>;
}