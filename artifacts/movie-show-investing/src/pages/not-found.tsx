import { ArrowLeft } from 'lucide-react';
import { Link } from 'wouter';

export default function NotFound() {
  return <section className="page-wrap flex min-h-[65dvh] flex-col justify-center py-24">
    <p className="eyebrow text-[#943c55]">An unexpected cut / 404</p>
    <h1 className="serif mt-7 text-[clamp(4.5rem,10vw,10rem)] leading-[.9]">This scene<br/><em>isn't here.</em></h1>
    <p className="mt-8 max-w-md text-base leading-relaxed text-[#535c60]">The page may have moved, or the address might have a typo. The story continues at home.</p>
    <Link href="/" data-testid="link-not-found-home" className="arrow-link mt-10 self-start border-b border-[#943c55] pb-2 text-sm font-bold text-[#943c55]"><ArrowLeft size={17}/> Back to home</Link>
  </section>;
}