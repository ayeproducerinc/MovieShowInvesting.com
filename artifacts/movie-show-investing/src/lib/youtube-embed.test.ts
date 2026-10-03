import assert from 'node:assert/strict';
import { test } from 'node:test';
import { youtubeEmbedUrl } from './youtube-embed.js';

const player = 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0';

test('normalizes supported YouTube video links to a trusted player', () => {
  for (const url of [
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ&feature=share',
    'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ?si=share',
    'https://youtube.com/shorts/dQw4w9WgXcQ',
    'https://youtube.com/live/dQw4w9WgXcQ',
    'https://www.youtube.com/embed/dQw4w9WgXcQ',
    'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1',
  ]) assert.equal(youtubeEmbedUrl(url), player);
});

test('rejects unsafe, unrelated, incomplete and malformed links', () => {
  for (const url of [
    null, undefined, '', 'not a url',
    'https://youtube.com/watch?v=bad',
    'https://youtube.com/playlist?list=dQw4w9WgXcQ',
    'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ',
    'https://evil.example/watch?v=dQw4w9WgXcQ',
    'https://user:pass@youtube.com/watch?v=dQw4w9WgXcQ',
    'javascript:alert(1)',
    'https://iframe.mediadelivery.net/embed/123/video',
  ]) assert.equal(youtubeEmbedUrl(url), null);
});