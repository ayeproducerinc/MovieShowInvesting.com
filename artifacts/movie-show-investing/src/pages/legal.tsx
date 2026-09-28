import { Link } from 'wouter';
import { ArrowUpRight } from 'lucide-react';

const legal = {
  privacy: {
    label: 'Privacy / How information is used',
    title: <>What we know.<br/><em>What we keep.</em></>,
    intro: 'This page explains how Movie Show Investing uses visitor, project, investor, account, and message information while the launch MVP is being built.',
    sections: [
      ['Information this site records', 'When you visit, the site may set a visitor ID cookie that lasts for one year and record the first campaign information in your URL: utm_source, utm_medium, utm_campaign, and ref. This helps us understand how visitors find the site. The site also receives ordinary technical information sent with a web request, such as your IP address and browser details.'],
      ['Project and investor information', 'If you submit a project or express investor interest, we store the details and contact information you provide to manage those submissions and non-binding indications of interest. Email-link sign-in identifies account holders. Please do not send personal, financial, or project information through URL parameters. No payment or investment transaction occurs on this site.'],
      ['Project messages', 'Project messages are visible to the signed-in investor and the filmmaker for that project. Authorized Movie Show Investing administrators can also read messages and reports, review safety concerns, and lock conversations. Messages are stored on the platform. Email notifications, if enabled, contain no message text. Do not share confidential scripts or sensitive personal or financial information.'],
      ['How information is used', 'Visitor and attribution data are used to understand site traffic and prepare the service. Project and investor details support the corresponding site features, and administrators may review reported or other project messages for safety and support. The public site count, when displayed, comes from our database.'],
      ['Updates and questions', 'We will update this notice before public launch, including a data-deletion contact. Please review the current notice when using the site.'],
    ],
  },
  terms: {
    label: 'Terms / Current site use',
    title: <>Using<br/><em>this site.</em></>,
    intro: 'These terms describe the features currently available while we build the Movie Show Investing launch MVP. No investment transactions or money movement take place here.',
    sections: [
      ['About the site', 'Movie Show Investing is operated by AYe Producer, Inc. You may share a project, explore approved projects, express non-binding investor interest, and use project messaging when it is available. These features do not create an investment commitment.'],
      ['No investment relationship', 'Nothing on this site is an offer to sell securities or a solicitation to buy them. No trade takes place, no money is collected, and viewing this site does not create an investment commitment or grant access to a future offering.'],
      ['Accuracy and availability', 'We may update, pause, or change site features as the launch MVP is built. Descriptions of later features explain current plans, not a promise that a feature, project, or opportunity will become available.'],
      ['Before public launch', 'We will update these terms as the remaining features are completed and before public launch. Please review the current terms before choosing to participate.'],
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