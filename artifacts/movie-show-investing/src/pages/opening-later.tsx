import { ArrowLeft, ArrowUpRight } from 'lucide-react';
import { Link } from 'wouter';
import { ArrowButton } from '@/components/site-shell';

export default function OpeningLater({ audience }: { audience: 'filmmaker' | 'investor' }) {
  const filmmaker = audience === 'filmmaker';
  return <div className="bg-[#f4f0e7]">
    <section className="page-wrap grid min-h-[670px] gap-12 py-14 md:min-h-[760px] md:grid-cols-[.6fr_.4fr] md:items-center md:gap-24 md:py-28">
      <div className="reveal">
        <Link href="/" data-testid="link-opening-home" className="arrow-link text-xs font-semibold text-[#656969]"><ArrowLeft size={16}/> Back to home</Link>
        <p className="eyebrow mt-16 text-[#943c55] md:mt-20">{filmmaker ? 'For filmmakers / Coming later' : 'For investors / Coming later'}</p>
        <h1 data-testid="text-opening-title" className="serif mt-7 text-[clamp(4rem,8vw,8rem)] leading-[.89] tracking-[-.045em]">{filmmaker ? <>The story starts <em>soon.</em></> : <>Your seat is <em>coming.</em></>}</h1>
        <p className="mt-8 max-w-[550px] text-[17px] leading-[1.8] text-[#535c60]">{filmmaker ? 'The filmmaker experience is still being built. Project submissions are not open yet. We’ll open this space for filmmakers first, with a way to share a project or join without one.' : 'Investor signup and non-binding pledges are not open yet. Filmmakers will come first; the investor experience will follow after real, approved projects are available.'}</p>
        <div className="mt-10 flex flex-wrap gap-4"><ArrowButton href="/faq" testId="link-opening-faq">Read the FAQ</ArrowButton><Link href="/" data-testid="link-opening-return" className="arrow-link px-2 text-sm font-semibold">Return home <ArrowUpRight size={17}/></Link></div>
      </div>
      <div className="relative flex min-h-[300px] items-center justify-center overflow-hidden border border-[#ada293] bg-[#e6ddce] md:min-h-[490px]">
        <div className="absolute inset-6 border border-[#bbab95] md:inset-10"/>
        <div className="absolute top-10 left-10 mono text-[10px] tracking-[.1em] text-[#806f63] md:top-14 md:left-14">MSI / {filmmaker ? '01' : '02'}</div>
        <div className="relative flex h-48 w-48 items-center justify-center rounded-full border border-[#a76c75] md:h-72 md:w-72"><div className="flex h-36 w-36 items-center justify-center rounded-full border border-[#a76c75] md:h-56 md:w-56"><div className="flex h-20 w-20 items-center justify-center rounded-full bg-[#943c55] text-[#f4f0e7] md:h-32 md:w-32"><span className="serif text-5xl italic md:text-7xl">{filmmaker ? 'F' : 'I'}</span></div></div></div>
        <div className="absolute right-10 bottom-10 mono text-[10px] uppercase tracking-[.1em] text-[#806f63] md:right-14 md:bottom-14">Opening later</div>
      </div>
    </section>
    <div className="border-t border-[#b9aea1] bg-[#e9e1d3]"><div className="page-wrap flex flex-col gap-4 py-8 text-sm leading-relaxed text-[#535c60] md:flex-row md:items-center md:justify-between"><span>{filmmaker ? 'There is no project submission or account creation at this stage.' : 'No investor accounts, pledges, or investment opportunities are available at this stage.'}</span><Link href="/disclaimers" data-testid="link-opening-disclaimers" className="arrow-link shrink-0 font-bold text-[#943c55]">Read the disclaimers <ArrowUpRight size={16}/></Link></div></div>
  </div>;
}