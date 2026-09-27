import { Link } from 'wouter';
import { ArrowUpRight } from 'lucide-react';

const legal = {
  privacy: {
    label: 'Privacy / Prelaunch information',
    title: <>What we know.<br/><em>What we keep.</em></>,
    intro: 'This page explains the limited information used by this prelaunch site. It will be expanded before filmmaker submissions and account features open.',
    sections: [
      ['Information this site records', 'When you visit, the site may set a visitor ID cookie that lasts for one year and record the first campaign information in your URL: utm_source, utm_medium, utm_campaign, and ref. This helps us understand how visitors find the site. The site also receives ordinary technical information sent with a web request, such as your IP address and browser details.'],
      ['What is not available yet', 'Project submissions, investor signup, pledges, and authentication are not open on this prelaunch site. Please do not send personal, financial, or project information through URL parameters.'],
      ['How information is used', 'Visitor and attribution data are used to understand site traffic and prepare the service. We do not use this page to collect payments or execute investments. The public site count, when displayed, comes from our database.'],
      ['Changes and questions', 'A fuller privacy notice, including a data-deletion contact and details for future account and message features, will be published before those features launch. Do not treat this preliminary notice as covering features that are not yet available.'],
    ],
  },
  terms: {
    label: 'Terms / Prelaunch information',
    title: <>The terms of<br/><em>this beginning.</em></>,
    intro: 'Movie Show Investing is currently an informational prelaunch site. These preliminary terms describe what is available today, not future investment or account terms.',
    sections: [
      ['About the site', 'Movie Show Investing is operated by AYe Producer, Inc. At this stage you may read about the planned service and visit informational pages. Filmmaker submissions, investor registration, and pledges are not available yet.'],
      ['No investment relationship', 'Nothing on this site is an offer to sell securities or a solicitation to buy them. No trade takes place, no money is collected, and viewing this site does not create an investment commitment or grant access to a future offering.'],
      ['Accuracy and availability', 'We may update, pause, or change this prelaunch site as the product develops. Descriptions of later features explain current plans, not a promise that a feature, project, or opportunity will become available.'],
      ['Before future features open', 'Additional terms for submissions, accounts, and indications of interest will be presented when those features are ready. Please review them then before choosing to participate.'],
    ],
  },
  disclaimers: {
    label: 'Disclaimers / Important context',
    title: <>A clear view<br/><em>of the risk.</em></>,
    intro: 'The site is being built for introductions and non-binding interest, not investment transactions. The filmmaker experience will open first; the investor experience will follow later.',
    sections: [
      ['Not an offering', "Pledge your interest in future investment opportunities. If a project opens for investment, it will be offered only in compliance with securities laws, and you'll get full offering documents before you decide."],
      ['No guarantee', 'Returns aren’t guaranteed. You may get back less, or nothing.'],
      ['Non-binding interest', 'A future pledge will only indicate interest. It will not be an investment, a reservation, or an obligation to invest. No trades happen here and no money is collected.'],
      ['Future project information', 'Any future description of a film or its terms should be reviewed alongside its full offering documents if an investment opens. A payback goal is not an expected or guaranteed outcome.'],
    ],
  },
};

export default function Legal({ kind }: { kind: keyof typeof legal }) {
  const page = legal[kind];
  return <div className="bg-[#f4f0e7]">
    <section className="border-b border-[#b9aea1] bg-[#e9e1d3]">
      <div className="page-wrap grid gap-7 py-16 md:grid-cols-[.3fr_.7fr] md:gap-20 md:py-24">
        <p className="eyebrow pt-2 text-[#943c55]">{page.label}</p>
        <div><h1 className="serif text-[clamp(4.5rem,8vw,8rem)] leading-[.89] tracking-[-.04em]">{page.title}</h1><p className="mt-8 max-w-[600px] text-base leading-[1.8] text-[#535c60]">{page.intro}</p></div>
      </div>
    </section>
    <section className="page-wrap grid gap-10 py-14 md:grid-cols-[.3fr_.7fr] md:gap-20 md:py-24">
      <div><p className="eyebrow text-[#8d4a5c]">The details</p><p className="mt-4 max-w-[235px] text-sm leading-relaxed text-[#71716b]">Plain language for where the site stands today.</p></div>
      <div className="border-t border-[#b9aea1]">
        {page.sections.map(([heading, content], index) => <article key={heading} className="grid gap-2 border-b border-[#b9aea1] py-8 sm:grid-cols-[45px_1fr] md:py-11"><span className="mono pt-2 text-[11px] text-[#943c55]">0{index + 1}</span><div><h2 className="serif text-[32px] leading-tight md:text-[40px]">{heading}</h2><p data-testid={`text-${kind}-section-${index + 1}`} className="mt-4 max-w-[630px] text-[15px] leading-[1.85] text-[#535c60]">{content}</p></div></article>)}
        <div className="mt-12 flex flex-wrap gap-8"><Link href="/faq" data-testid={`link-${kind}-faq`} className="arrow-link border-b border-[#943c55] pb-2 text-sm font-bold text-[#943c55]">More questions <ArrowUpRight size={16}/></Link><Link href="/" data-testid={`link-${kind}-home`} className="arrow-link border-b border-[#943c55] pb-2 text-sm font-bold text-[#943c55]">Back to home <ArrowUpRight size={16}/></Link></div>
      </div>
    </section>
  </div>;
}