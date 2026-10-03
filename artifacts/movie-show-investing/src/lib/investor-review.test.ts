import assert from 'node:assert/strict';
import { test } from 'node:test';
import { investorReviewKey, minimaForSelectedStages } from './investor-review.js';

test('unchecked stages do not affect matching or submitted minima', () => {
  const original = {distribution: 125, production: 150, idea: 175};
  assert.deepEqual(minimaForSelectedStages(original, ['production']), {
    distribution:null, production:150, idea:null,
  });
  assert.deepEqual(original, {distribution:125, production:150, idea:175});
  assert.deepEqual(minimaForSelectedStages(original, []), {
    distribution:null, production:null, idea:null,
  });
});

test('exact review is independent of server allocation ordering', () => {
  const a = {name:'Example Investor', amount:100, unallocated:false, allocations:[{project_id:1,amount:25},{project_id:2,amount:75}]};
  assert.equal(investorReviewKey(a), investorReviewKey({...a, allocations:[...a.allocations].reverse()}));
  assert.notEqual(investorReviewKey(a), investorReviewKey({...a, amount:200}));
  assert.notEqual(investorReviewKey(a), investorReviewKey({...a, allocations:[{project_id:1,amount:75},{project_id:2,amount:25}]}));
  assert.notEqual(investorReviewKey(a), investorReviewKey({...a, name:'Another Investor'}));
});

test('unallocated interest cannot be mistaken for an allocated signature', () => {
  const a = {name:'Example Investor', amount:100, unallocated:true, allocations:[]};
  assert.notEqual(investorReviewKey(a), investorReviewKey({...a, unallocated:false, allocations:[{project_id:1,amount:100}]}));
});