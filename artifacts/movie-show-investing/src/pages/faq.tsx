import { Link } from 'wouter';
import { ArrowUpRight } from 'lucide-react';

const questions = [
  ['What is Movie Show Investing?', 'A platform where filmmakers share projects and investors pledge interest, so both sides can find each other before investment opens.'],
  ['Is my pledge an investment?', "No. No trades happen here and no money is collected. A pledge is a non-binding indication of interest. If a project opens for investment, you'll be invited to decide then."],
  ['How will money flow when investment opens?', "Viewers rent, buy, or license the film → our affiliated distribution platform collects the revenue (payment processing fees come off first) → automated revenue splits pay investors, the filmmaker, and the platform according to the project's terms."],
  ["Who's the distribution platform?", 'Movie Show Investing and The AYeList are both run by AYe Producer, Inc. The AYeList is our distribution channel, with on-demand streaming and automated revenue splits.'],
  ['How are my ideas protected?', 'Share loglines and synopses, not full scripts. Consider registering your script with the U.S. Copyright Office or the WGA registry before sharing widely.'],
];

export default function FAQ() {
  return <div className="bg-[#f4f0e7]">
    <div className="page-wrap pt-16 pb-16 md:pt-24 md:pb-28">
      <div className="grid gap-8 border-b border-[#b9aea1] pb-14 md:grid-cols-[.3fr_.7fr] md:gap-20 md:pb-20">
        <p className="eyebrow pt-2 text-[#943c55]">A little more clarity / 001</p>
        <div><h1 className="serif text-[clamp(4.5rem,9vw,9rem)] leading-[.88] tracking-[-.045em]">Good questions.<br/><em>Clear answers.</em></h1><p className="mt-7 max-w-[530px] text-base leading-[1.7] text-[#5b6263]">The basics on what Movie Show Investing is, what it isn’t, and what comes next.</p></div>
      </div>
      <div className="md:ml-[calc(30%+2rem)]">
        {questions.map(([question, answer], index) => <section key={question} className="grid gap-3 border-b border-[#b9aea1] py-9 md:grid-cols-[52px_1fr] md:gap-5 md:py-11">
          <span className="mono pt-1 text-[11px] text-[#943c55]">0{index + 1}</span>
          <div><h2 className="serif text-[33px] leading-[1.1] md:text-[42px]">{question}</h2><p data-testid={`text-faq-answer-${index + 1}`} className="mt-5 max-w-[630px] text-[15px] leading-[1.8] text-[#4d5558]">{answer}</p></div>
        </section>)}
        <div className="pt-12"><p className="eyebrow text-[#943c55]">Where to next?</p><div className="mt-6 flex flex-wrap gap-5"><Link href="/start/filmmaker" data-testid="link-faq-filmmaker" className="arrow-link border-b border-[#943c55] pb-2 text-sm font-bold text-[#943c55]">For filmmakers <ArrowUpRight size={17}/></Link><Link href="/invest" data-testid="link-faq-invest" className="arrow-link border-b border-[#943c55] pb-2 text-sm font-bold text-[#943c55]">For investors <ArrowUpRight size={17}/></Link></div></div>
      </div>
    </div>
  </div>;
}