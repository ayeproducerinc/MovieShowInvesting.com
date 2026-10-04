import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bunnyEmbedUrl } from './bunny-embed.js';

test('Bunny embeds explicitly disable autoplay and preserve access parameters', () => {
  for (const query of ['', '?autoplay=true', '?autoplay=1&autoplay=true']) {
    const result = new URL(bunnyEmbedUrl(`https://iframe.mediadelivery.net/embed/123/video${query}`)!);
    assert.deepEqual(result.searchParams.getAll('autoplay'), ['false']);
  }
  const signed = new URL(bunnyEmbedUrl('https://iframe.mediadelivery.net/embed/123/video?token=fixture-token&expires=123&autoplay=true&controls=true')!);
  assert.equal(signed.searchParams.get('token'), 'fixture-token');
  assert.equal(signed.searchParams.get('expires'), '123');
  assert.equal(signed.searchParams.get('controls'), 'true');
  assert.equal(signed.searchParams.get('autoplay'), 'false');
});

test('rejects malformed, unrelated and credential-bearing Bunny URLs', () => {
  for (const value of [
    null, undefined, '', 'not a URL', 'javascript:alert(1)',
    'https://iframe.mediadelivery.net.evil.example/embed/123/video',
    'https://user:pass@iframe.mediadelivery.net/embed/123/video',
    'https://iframe.mediadelivery.net/play/123/video',
  ]) assert.equal(bunnyEmbedUrl(value), null);
});