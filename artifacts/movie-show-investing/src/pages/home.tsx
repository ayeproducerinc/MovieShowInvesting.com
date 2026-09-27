import { ArrowDown, ArrowRight, Clapperboard, Film, Handshake, MoveUpRight } from 'lucide-react';
import { Link } from 'wouter';
import { ArrowButton } from '@/components/site-shell';
import { usePublicSite } from '@/hooks/use-public-site';

export default function Home() {
  const { stats } = usePublicSite();
  return <>
    <section className="relative overflow-hidden bg-[#f4f0e7]">
      <div className="page-wrap grid min-h-[680px] gap-10 pt-14 pb-14 md:min-h-[710px] md:grid-cols-[1.03fr_.97fr] md:items-center md:gap-14 md:pt-20 md:pb-24">
        <div className="relative z-10 reveal">
          <div className="mb-8 flex items-center gap-3"><span className="h-[1px] w-7 bg-[#943c55]"/><p className="eyebrow text-[#943c55]">A new path for independent film</p></div>
           <h1 data-testid="text-home-headline" className="serif max-w-[780px] text-[clamp(4.2rem,8vw,8.5rem)] leading-[.87] tracking-[-.045em]">Your film has a story. <em className="text-[#943c55]">So does its future.</em></h1>
           <p className="mt-8 max-w-[485px] text-[16px] leading-[1.7] text-[#535b60] md:mt-10 md:text-[18px]">Tell us where your project stands and explore what a future path could look like. This is an early conversation, with no money collected and no decisions required.</p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row md:mt-11">
            <ArrowButton href="/start/filmmaker" testId="link-home-filmmaker">I'm a filmmaker</ArrowButton>
             <ArrowButton href="/invest" testId="link-home-invest" outline>For future investors</ArrowButton>
          </div>
          {stats.isLoading && <div aria-label="Loading filmmaker count" className="mt-10 h-4 w-44 animate-pulse bg-[#d9d1c3]"/>}
          {stats.isError && <div className="mt-7 text-xs text-[#64696b]">Community count is temporarily unavailable. <button type="button" data-testid="button-retry-stats" onClick={() => stats.refetch()} className="underline underline-offset-4 hover:text-[#943c55]">Try again</button></div>}
          {typeof stats.data?.filmmakers === 'number' && stats.data.filmmakers > 0 && <p data-testid="text-filmmaker-count" className="mono mt-8 text-[10px] uppercase tracking-[.14em] text-[#5b6062]"><span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-[#943c55] align-middle"/> {stats.data.filmmakers.toLocaleString()} filmmakers have joined</p>}
        </div>
        <div className="relative reveal-delayed">
          <div className="relative aspect-[.93] overflow-hidden bg-[#202936] md:aspect-[.82]">
            <img src="/film-frame.jpg" alt="An empty cinema with a softly illuminated screen" className="h-full w-full object-cover object-center opacity-90" />
            <div className="absolute inset-0 bg-gradient-to-t from-[#101923]/65 via-transparent to-transparent"/>
            <div className="absolute bottom-6 left-6 right-6 text-[#f4f0e7] md:bottom-9 md:left-9 md:right-9"><p className="serif text-[30px] leading-none italic md:text-[40px]">Every film begins somewhere.</p></div>
          </div>
          <div className="absolute -bottom-5 -left-4 flex h-[82px] w-[82px] items-center justify-center rounded-full border border-[#9f8e7a] bg-[#e8ba79] md:-left-8 md:h-[116px] md:w-[116px]"><Film size={31} strokeWidth={1.2} className="text-[#202936] md:h-10 md:w-10"/></div>
        </div>
      </div>
      <div className="border-t hairline"><div className="page-wrap flex items-center justify-between py-5"><span className="eyebrow text-[#7b7771]">An introduction, not a transaction</span><ArrowDown size={18} strokeWidth={1.5}/></div></div>
    </section>

    <section id="how-it-works" className="bg-[#e9e1d3] py-24 md:py-36">
      <div className="page-wrap">
        <div className="grid gap-8 md:grid-cols-[.42fr_.58fr] md:gap-20">
          <p className="eyebrow mt-3 text-[#943c55]">The idea / 001</p>
          <div><h2 className="serif max-w-[780px] text-[clamp(3.4rem,6vw,6.5rem)] leading-[.95] tracking-[-.035em]">The next chapter starts <em>with a conversation.</em></h2><p className="mt-8 max-w-[590px] text-[16px] leading-[1.8] text-[#4e5557]">Filmmaking takes more than a good idea. Movie Show Investing is being built to help filmmakers show their projects and understand potential investor interest before investment opens. No trades happen here, and no money is collected.</p></div>
        </div>
        <div className="mt-20 grid border-t border-[#a99f91] md:mt-28 md:grid-cols-2">
          <div className="border-b border-[#a99f91] py-10 md:border-r md:pr-16 md:py-14">
            <span className="mono text-[11px] text-[#943c55]">01 — FOR THE MAKERS</span>
            <Clapperboard className="mt-11 text-[#943c55]" size={32} strokeWidth={1.3}/>
            <h3 className="serif mt-5 text-[43px] leading-none">Bring your story.</h3>
             <p className="mt-5 max-w-[400px] text-sm leading-[1.75] text-[#555c5e]">Tell us where your project stands, explore illustrative terms, or simply let us know you’d like to be part of what comes next.</p>
             <Link href="/start/filmmaker" data-testid="link-section-filmmaker" className="arrow-link mt-8 border-b border-[#943c55] pb-2 text-sm font-bold text-[#943c55]">Start the filmmaker worksheet <ArrowRight size={17}/></Link>
          </div>
          <div className="py-10 md:pl-16 md:py-14">
            <span className="mono text-[11px] text-[#943c55]">02 — FOR THE CURIOUS</span>
            <Handshake className="mt-11 text-[#943c55]" size={32} strokeWidth={1.3}/>
            <h3 className="serif mt-5 text-[43px] leading-none">Discover what’s possible.</h3>
            <p className="mt-5 max-w-[400px] text-sm leading-[1.75] text-[#555c5e]">The investor experience will open later, after real projects are available. Interest here will be non-binding; any investment decision would come separately.</p>
            <Link href="/invest" data-testid="link-section-invest" className="arrow-link mt-8 border-b border-[#943c55] pb-2 text-sm font-bold text-[#943c55]">About investor access <ArrowRight size={17}/></Link>
          </div>
        </div>
      </div>
    </section>

    <section className="bg-[#202936] py-24 text-[#f4f0e7] md:py-36">
      <div className="page-wrap grid gap-14 md:grid-cols-[.5fr_.5fr] md:gap-24">
        <div><span className="eyebrow text-[#dfb674]">A note on what this is</span><p className="serif mt-9 text-[clamp(3.3rem,5.5vw,6.8rem)] leading-[.94] tracking-[-.03em]">Interest first.<br/><em>Everything else, later.</em></p></div>
        <div className="flex flex-col justify-end border-l border-[#7b8187] pl-7 md:pl-12">
          <p className="max-w-[480px] text-[17px] leading-[1.8] text-[#d6d5cf]">This is a space to explore a future connection between films and people who believe in them. A pledge is an indication of interest, not an investment or an obligation. Investment is not available on this site today.</p>
          <Link href="/faq" data-testid="link-home-faq" className="arrow-link mt-9 self-start border-b border-[#dfb674] pb-2 text-sm font-bold text-[#dfb674]">Read the questions <ArrowRight size={18}/></Link>
        </div>
      </div>
    </section>

    <section className="bg-[#f4f0e7] py-24 md:py-36">
      <div className="page-wrap grid gap-10 md:grid-cols-[.36fr_.64fr] md:gap-16">
        <div><span className="eyebrow text-[#943c55]">Before you begin / 002</span><h2 className="serif mt-6 text-[clamp(3.2rem,5vw,5.7rem)] leading-[.95]">A few things<br/><em>worth knowing.</em></h2></div>
        <div className="border-t border-[#a99f91]">
          {[['No money changes hands','The site does not collect money or execute trades.'],['Filmmakers come first','The first launch is for filmmakers. Investor signup and pledges follow later, once approved projects are available.'],['A decision comes later','If a project eventually opens for investment, you can review the full offering documents before deciding.']].map(([title, body], index) => <div key={title} className="grid gap-3 border-b border-[#a99f91] py-8 sm:grid-cols-[42px_1fr] md:py-10"><span className="mono pt-1 text-xs text-[#943c55]">0{index + 1}</span><div><h3 className="text-xl font-semibold tracking-[-.03em]">{title}</h3><p className="mt-2 max-w-[500px] text-sm leading-[1.7] text-[#5c6263]">{body}</p></div></div>)}
          <Link href="/disclaimers" data-testid="link-home-disclaimers" className="arrow-link mt-8 text-sm font-semibold text-[#943c55]">Read the disclaimers <MoveUpRight size={16}/></Link>
        </div>
      </div>
    </section>

    <section className="border-t hairline bg-[#dcb17d] py-20 md:py-28">
      <div className="page-wrap flex flex-col gap-10 md:flex-row md:items-end md:justify-between">
        <div><p className="eyebrow text-[#733c45]">The opening frame</p><h2 className="serif mt-6 max-w-[740px] text-[clamp(3.6rem,7vw,7.7rem)] leading-[.9] tracking-[-.04em]">Your story is<br/><em>the starting point.</em></h2></div>
         <div className="flex flex-col items-start gap-4"><ArrowButton href="/start/filmmaker" testId="link-bottom-filmmaker">Start the worksheet</ArrowButton><p className="max-w-[255px] text-xs leading-relaxed text-[#5a4a47]">Explore the early-stage questions at your own pace. No money is collected.</p></div>
      </div>
    </section>
  </>;
}