import { Link } from 'wouter';
import { ArrowRight, Check } from 'lucide-react';
import { choosePitchReview } from '@/lib/pitch-review-intent';

export default function Pricing() {
  return <section className="dossier">
    <div className="page-wrap dossier-hero">
      <p className="dossier-kicker">For filmmakers / pricing</p>
      <h1 className="dossier-title">Start free.<br/><em>Choose review when ready.</em></h1>
      <p className="dossier-lead">Create a film or show pitch and share its unlisted page at no cost. Submit it for editorial review only when you choose to.</p>
      <div className="grid gap-6 md:grid-cols-2" style={{ marginTop: 48 }}>
        <div className="border border-[#c8c0b5] p-7 md:p-9">
          <span className="dossier-kicker">Free pitch page</span>
          <h2 className="serif mt-4 text-5xl">$0</h2>
          <p className="mt-6 leading-relaxed">Create and edit your pitch, keep it unlisted, and share its link with people you choose. No review request is made.</p>
          <p className="mt-5 text-sm"><Check size={16} className="inline" /> Your page and share link remain free.</p>
          <Link href="/start/filmmaker?new=1" onClick={() => choosePitchReview(false)} className="dossier-button dossier-button-outline mt-8 inline-flex" data-testid="link-free-pitch">Create a free pitch <ArrowRight size={17}/></Link>
        </div>
        <div className="border-2 border-[#943c55] bg-[#fff8ed] p-7 md:p-9">
          <span className="dossier-kicker">Pitch Collection / editorial review</span>
          <h2 className="serif mt-4 text-5xl">$49 <small className="text-base not-italic">one time per pitch</small></h2>
          <p className="mt-6 leading-relaxed">Submit one film or show pitch for editorial review. Payment sends your pitch to our review queue. <strong>Approval is not guaranteed.</strong> If approved, we’ll list it in Explore’s public Pitch Collection, with no preset expiration date.</p>
          <p className="mt-4 leading-relaxed">Join the early filmmaker lineup as we build the Pitch Collection that investors will be able to browse when they join.</p>
          <p className="mt-4 text-sm">The review fee is not automatically refunded if we complete your review and decline the pitch. If we cannot deliver the review, we’ll refund it, subject to applicable law.</p>
          <p className="mt-4 text-sm font-semibold">Test checkout only · no real charge</p>
          <Link href="/start/filmmaker?new=1" onClick={() => choosePitchReview(true)} className="dossier-button mt-8 inline-flex" data-testid="link-paid-pitch">Create your pitch <ArrowRight size={17}/></Link>
          <p className="mt-4 text-sm">Already have a pitch? <Link href="/me/projects?action=manage" className="underline">Open My projects</Link>.</p>
        </div>
      </div>
      <p className="mt-8 text-sm">Choose the paid path to check out after finishing your pitch. If you start free, you can choose “Submit for review” on your confirmation screen later. Only confirmed payment sends your pitch to review.</p>
    </div>
  </section>;
}