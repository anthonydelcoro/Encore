// node tools/test-logic.js
const assert = require('assert');
const H = require('../app.js');

const songs = [
  { id: 1, t: 'Everlong', a: 'Foo Fighters', e: '90s' },
  { id: 2, t: 'Best of You', a: 'Foo Fighters', e: '00s' },
  { id: 3, t: "Don't Stop Believin'", a: 'Journey', e: '80s' },
  { id: 4, t: 'Black', a: 'Pearl Jam', e: '90s' },
  { id: 5, t: 'Back in Black', a: 'AC/DC', e: '80s' },
  { id: 6, t: 'Paint It Black', a: 'The Rolling Stones', e: '70s' },
  { id: 7, t: 'Sweet Child O\' Mine', a: 'Guns N\' Roses', e: '80s' },
];

// norm
assert.strictEqual(H.norm("Don't Stop Believin'"), 'dont stop believin');
assert.strictEqual(H.norm('Mötley Crüe'), 'motley crue');
assert.strictEqual(H.norm('Joan Jett & The Blackhearts'), 'joan jett and the blackhearts');

// search
assert.deepStrictEqual(H.searchSongs(songs, 'black').map(s => s.id), [4, 5, 6], 'title-start ranks first');
assert.deepStrictEqual(H.searchSongs(songs, 'foo').map(s => s.id).sort(), [1, 2], 'artist search');
assert.deepStrictEqual(H.searchSongs(songs, 'dont stop').map(s => s.id), [3], 'apostrophes ignored');
assert.deepStrictEqual(H.searchSongs(songs, "guns sweet").map(s => s.id), [7], 'mixed artist+title words');
assert.deepStrictEqual(H.searchSongs(songs, 'lack'), [], 'only word-start matches');
assert.deepStrictEqual(H.searchSongs(songs, '   '), []);
assert.strictEqual(H.searchSongs(songs, 'b', 2).length, 2, 'limit');

// judge
assert.strictEqual(H.judge(songs[0], songs[0]), 'right');
assert.strictEqual(H.judge(songs[0], songs[1]), 'artist');
assert.strictEqual(H.judge(songs[0], songs[2]), 'wrong');
assert.strictEqual(H.judge(songs[0], { id: 99, t: 'Everlong', a: 'Foo Fighters' }), 'right', 'same title+artist, different id');
assert.strictEqual(H.judge(songs[0], null), 'wrong');

// pool + picking
assert.deepStrictEqual(H.filterPool(songs, ['80s']).map(s => s.id), [3, 5, 7]);
const pool = H.filterPool(songs, ['70s', '80s', '90s', '00s']);
let recent = [];
const seen = new Set();
for (let i = 0; i < pool.length; i++) {
  const s = H.pickSong(pool, recent);
  assert.ok(!recent.includes(s.id), 'no repeat while unplayed songs remain in window');
  seen.add(s.id);
  recent = H.rememberPlayed(recent, s.id, pool.length);
}
assert.ok(recent.length <= Math.floor(pool.length * 0.75), 'recent list capped');
// Long run: never returns null, never repeats the immediately previous song
let prev = null; recent = [];
for (let i = 0; i < 500; i++) {
  const s = H.pickSong(pool, recent);
  assert.ok(s);
  assert.notStrictEqual(s.id, prev, 'no back-to-back repeat');
  prev = s.id; recent = H.rememberPlayed(recent, s.id, pool.length);
}
assert.strictEqual(H.pickSong([], []), null);
// Single-song pool still works
assert.strictEqual(H.pickSong([songs[0]], [1]).id, 1);

// fmt
assert.strictEqual(H.fmt(0), '0:00');
assert.strictEqual(H.fmt(16), '0:16');
assert.strictEqual(H.fmt(75.9), '1:15');

// difficulty tables are increasing
for (const d of Object.values(H.DIFFICULTY)) {
  assert.strictEqual(d.stages.length, 6);
  for (let i = 1; i < 6; i++) assert.ok(d.stages[i] > d.stages[i - 1]);
  assert.ok(d.stages[5] <= 30, 'fits inside a 30s preview');
}
console.log('All logic tests passed.');
