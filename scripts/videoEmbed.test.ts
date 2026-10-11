import assert from 'node:assert/strict';
import { test } from 'node:test';
import { autoplaySrc, playerSignal, videoEmbed, withOrigin } from '../src/card/videoEmbed.ts';

const id = 'M7lc1UVf-VE';

test('a preloaded player does not autoplay', () => {
  const watch = videoEmbed(`https://www.youtube.com/watch?v=${id}`);
  assert.ok(watch);
  assert.equal(watch.kind, 'youtube');
  assert.equal(watch.player, `https://www.youtube-nocookie.com/embed/${id}?rel=0&playsinline=1&enablejsapi=1`);
  assert.equal(watch.player.includes('autoplay'), false);
  assert.equal(watch.thumb, `https://i.ytimg.com/vi/${id}/hqdefault.jpg`);
  assert.equal(videoEmbed(`https://youtu.be/${id}`)?.player, watch.player);
  assert.equal(videoEmbed(`https://www.youtube.com/shorts/${id}`)?.id, id);
  assert.equal(videoEmbed(`https://www.youtube.com/embed/${id}`)?.id, id);
  assert.equal(videoEmbed('https://www.youtube.com/@NBA'), undefined);
  assert.equal(videoEmbed('not a url'), undefined);

  const vimeo = videoEmbed('https://vimeo.com/123456789');
  assert.ok(vimeo);
  assert.equal(vimeo.kind, 'vimeo');
  assert.equal(vimeo.player, 'https://player.vimeo.com/video/123456789?playsinline=1');
  assert.equal(vimeo.player.includes('autoplay'), false);
});

test('autoplay is added only for the tap that starts the clip', () => {
  const embed = videoEmbed(`https://m.youtube.com/watch?v=${id}`);
  assert.ok(embed);
  const placed = withOrigin(embed, 'https://zo.fyi');
  assert.equal(placed.includes('autoplay'), false);
  assert.equal(new URL(placed).searchParams.get('origin'), 'https://zo.fyi');
  const started = autoplaySrc(placed);
  assert.equal(new URL(started).searchParams.get('autoplay'), '1');
  assert.equal(new URL(started).searchParams.get('origin'), 'https://zo.fyi');
  assert.equal(new URL(autoplaySrc(started)).searchParams.getAll('autoplay').length, 1);
  assert.equal(withOrigin(embed, undefined), embed.player);
});

test('player messages say when the clip is ready and when it is playing', () => {
  assert.deepEqual(playerSignal(JSON.stringify({ event: 'onReady' })), { ready: true });
  assert.deepEqual(playerSignal(JSON.stringify({ event: 'initialDelivery', info: { playerState: -1 } })), { ready: true });
  assert.deepEqual(playerSignal(JSON.stringify({ event: 'infoDelivery', info: { playerState: 1 } })), { playing: true });
  assert.deepEqual(playerSignal(JSON.stringify({ event: 'onStateChange', info: 3 })), { playing: true });
  assert.deepEqual(playerSignal(JSON.stringify({ event: 'onStateChange', info: 2 })), {});
  assert.deepEqual(playerSignal({ event: 'ready' }), { ready: true });
  assert.deepEqual(playerSignal({ event: 'play' }), { playing: true });
  assert.deepEqual(playerSignal('not-json'), {});
  assert.deepEqual(playerSignal({ hello: 'there' }), {});
});
