import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pitchDetailsFingerprint, type PitchDetailsFields } from './pitch-details-state.js';

const initial: PitchDetailsFields = {
  publicName: 'Test filmmaker', links: '', teamInfo: '', moneyUse: '', distribution: '',
  cfRan: null, cfCampaign: '', cfSame: null, cfGoal: '', cfRaised: '', cfObligations: '',
};

test('detects edits to every detail field', () => {
  const baseline = pitchDetailsFingerprint(initial);
  for (const name of ['publicName', 'links', 'teamInfo', 'moneyUse', 'distribution'] as const) {
    assert.notEqual(pitchDetailsFingerprint({ ...initial, [name]: 'Changed' }), baseline);
  }
  assert.notEqual(pitchDetailsFingerprint({ ...initial, cfRan: false }), baseline);
});

test('detects every visible crowdfunding field, including invalid amounts', () => {
  const campaign = { ...initial, cfRan: true };
  const baseline = pitchDetailsFingerprint(campaign);
  for (const name of ['cfCampaign', 'cfGoal', 'cfRaised', 'cfObligations'] as const) {
    assert.notEqual(pitchDetailsFingerprint({ ...campaign, [name]: 'Changed' }), baseline);
  }
  assert.notEqual(pitchDetailsFingerprint({ ...campaign, cfSame: true }), baseline);
});

test('matches saved normalization and retains hidden campaign values without marking them dirty', () => {
  assert.equal(pitchDetailsFingerprint({ ...initial, publicName: ' Test filmmaker ', links: '\n ', cfCampaign: 'retained' }),
    pitchDetailsFingerprint(initial));
  assert.equal(pitchDetailsFingerprint({ ...initial, cfRan: true, cfGoal: '100.00' }),
    pitchDetailsFingerprint({ ...initial, cfRan: true, cfGoal: '100' }));
});