import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { Router } from 'wouter';
import type { ComponentProps } from 'react';
import { InvestorProjectCard } from './investor-project-card';
import '../lib/explore-recap.test';

type Project = ComponentProps<typeof InvestorProjectCard>['project'];
const project: Project = {
  id: 1, slug: 'story-fixture', title: 'Story fixture', format: 'show',
  stage: 'production', genre: 'Sci-Fi', logline: 'A courier discovers a hidden world. A second sentence stays on the project page.',
  poster_url: null, pitch_deck_url: 'https://example.com/pitch.pdf', pitch_deck_name: 'Pitch',
  budget: 250000, offer_per_100: 125, confirmed_pledge_total: 0, is_owner: false,
  proposal: {
    decision: 'standard', repayment_per100: 150, investor_backend_percent: 50, backend_years: 10, early_filmmaker_percent: 0,
    original_repayment_per100: 150, platform_fee_percent: 10, fee_priority: 'existing_proportional',
    backend_revenue_basis: 'after_processing_and_distribution_fees', backend_clock: 'after_investor_target', version: 1,
  },
};
const render = (value: Project, options: Omit<ComponentProps<typeof InvestorProjectCard>, 'project'> = {}) =>
  renderToStaticMarkup(<Router ssrPath="/explore"><InvestorProjectCard project={value} {...options}/></Router>);

test('every Explore proposal state hides the complete deal and budget', () => {
  const variants: Project[] = [
    project,
    { ...project, id: 2, proposal: { ...project.proposal!, decision: 'negotiation' } },
    { ...project, id: 999999, proposal: null },
    { ...project, id: 999998, proposal: undefined, budget: null },
  ];
  for (const value of variants) {
    const before = JSON.stringify(value);
    const html = render(value, { variant: 'explore', showPitchDeck: true });
    assert.ok(html.includes(value.title));
    assert.ok(html.includes('View project'));
    assert.ok(html.includes(`/project/${value.slug}`));
    assert.ok(html.includes('A courier discovers a hidden world.'));
    assert.ok(!html.includes('A second sentence'));
    assert.ok(!html.includes(`data-testid="proposal-${value.id}"`));
    assert.ok(!html.includes('250,000'));
    assert.ok(!html.includes('View pitch deck'));
    assert.equal(JSON.stringify(value), before);
  }
});

test('other shared-card contexts retain full stories and standard or negotiated terms', () => {
  const standard = render(project);
  assert.ok(standard.includes('Standard terms accepted'));
  assert.ok(standard.includes('A second sentence'));
  const negotiated = render({ ...project, proposal: { ...project.proposal!, decision: 'negotiation' } });
  assert.ok(negotiated.includes('Open to negotiation'));
});

test('cards credit the filmmaker only when a public name was chosen', () => {
  assert.ok(render({ ...project, public_filmmaker_name: 'Jordan L.' }, { variant: 'explore' }).includes('by Jordan L.'));
  assert.ok(!render({ ...project, public_filmmaker_name: null }, { variant: 'explore' }).includes('text-project-filmmaker-'));
});

test('Explore missing data and owner access stay usable', () => {
  const html = render({ ...project, logline: null, genre: null, stage: null, format: null, is_owner: true }, { variant: 'explore' });
  assert.ok(html.includes('View the project to discover more about this story.'));
  assert.ok(html.includes('Genre not listed'));
  assert.ok(html.includes('Stage not listed'));
  assert.ok(html.includes('Your project'));
  assert.ok(html.includes('Manage project'));
  assert.ok(!html.includes('<img'));
});
