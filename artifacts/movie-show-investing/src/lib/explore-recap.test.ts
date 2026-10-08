import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exploreStoryHook } from './explore-recap.js';

test('story recap prefers the first sentence and normalizes whitespace', () => {
  assert.equal(exploreStoryHook(' A courier  steps outside time. \nThe journey changes everything.'), 'A courier steps outside time.');
});

test('long story hooks are capped at 30 words without editing the source', () => {
  const source = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
  const hook = exploreStoryHook(source);
  assert.equal(hook.split(/\s+/).length, 30);
  assert.ok(hook.endsWith('word29…'));
  assert.equal(source.split(' ').length, 60);
});

test('short stories and missing loglines remain safe', () => {
  assert.equal(exploreStoryHook('A story without punctuation'), 'A story without punctuation');
  for (const value of [null, undefined, '', ' \n ']) {
    assert.equal(exploreStoryHook(value), 'View the project to discover more about this story.');
  }
  assert.equal(exploreStoryHook('“A courier disappears!” A search begins.'), '“A courier disappears!”');
});
