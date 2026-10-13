// Runs inside a browser tab on any https origin. Resolves SEED (array of
// {era, artist, title}) to iTunes tracks, throttled under Apple's ~20/min limit.
// Results accumulate in window.__RES; progress in window.__PROG.
(function () {
  const BAD = /\b(live|acoustic|demo|karaoke|instrumental|remix|mix|cover|tribute|rehearsal|session|unplugged|mtv|orchestral|symphon|version|edit|re-?recorded|commentary|interview|backing track|in the style of|made famous|originally performed)\b/i;
  const norm = s => s.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
  const base = s => norm(s.replace(/\s*[\(\[][^\)\]]*(remaster|version|mono|stereo|edit|mix|live|feat|single|deluxe|bonus|from )[^\)\]]*[\)\]]/ig, '')
    .replace(/\s+-\s+.*(remaster|version|mono|stereo|edit|mix|live).*$/i, ''));
  const artistOk = (want, got) => {
    const w = norm(want).replace(/^the /, ''), g = norm(got).replace(/^the /, '');
    return g === w || g.startsWith(w) || w.startsWith(g);
  };
  function score(seed, r) {
    if (!r.previewUrl || r.kind !== 'song') return -1;
    if (!artistOk(seed.artist, r.artistName)) return -1;
    const want = base(seed.title), got = base(r.trackName);
    const wantRaw = norm(seed.title);
    let s = 0;
    if (got === want || norm(r.trackName) === wantRaw) s += 100;
    else if (got.startsWith(want) || want.startsWith(got)) s += 40;
    else return -1;
    const extra = (r.trackName + ' ' + r.collectionName);
    if (BAD.test(r.trackName) && !BAD.test(seed.title)) s -= 80;
    if (/\blive\b|acoustic|unplugged|karaoke|tribute|in concert|bbc|sessions/i.test(r.collectionName)) s -= 60;
    if (/remaster/i.test(extra)) s -= 2;            // prefer originals slightly
    if (/greatest|best of|hits|collection|essential|anthology/i.test(r.collectionName)) s -= 5;
    if (r.primaryGenreName && /rock|metal|alternative|punk|hard rock|grunge/i.test(r.primaryGenreName)) s += 5;
    return s;
  }
  function jsonp(url) {
    return new Promise((res, rej) => {
      const cb = '__j' + Math.random().toString(36).slice(2);
      const s = document.createElement('script');
      const t = setTimeout(() => { cleanup(); rej(new Error('timeout')); }, 15000);
      function cleanup() { clearTimeout(t); delete window[cb]; s.remove(); }
      window[cb] = d => { cleanup(); res(d); };
      s.onerror = () => { cleanup(); rej(new Error('script error')); };
      s.src = url + '&callback=' + cb;
      document.head.appendChild(s);
    });
  }
  window.__score = score;
  window.__RES = window.__RES || [];
  window.__PROG = { done: 0, total: SEED.length, errors: 0, running: true };
  (async () => {
    for (let i = window.__RES.length; i < SEED.length; i++) {
      const seed = SEED[i];
      const term = encodeURIComponent((seed.artist + ' ' + seed.title).replace(/[()?!.,]/g, ' '));
      let out = { ...seed, ok: false };
      try {
        const d = await jsonp(`https://itunes.apple.com/search?term=${term}&media=music&entity=song&limit=25&country=US`);
        const ranked = d.results.map(r => [score(seed, r), r]).filter(x => x[0] > 0).sort((a, b) => b[0] - a[0]);
        if (ranked.length) {
          const [sc, r] = ranked[0];
          out = { ...seed, ok: true, score: sc, id: r.trackId, trackName: r.trackName, artistName: r.artistName,
                  album: r.collectionName, year: (r.releaseDate || '').slice(0, 4), genre: r.primaryGenreName,
                  preview: r.previewUrl, art: r.artworkUrl100, url: r.trackViewUrl };
        } else {
          out.top = d.results.slice(0, 4).map(r => r.artistName + ' — ' + r.trackName + ' [' + r.collectionName + ']');
        }
      } catch (e) { out.err = String(e); window.__PROG.errors++; }
      window.__RES.push(out);
      window.__PROG.done = i + 1;
      await new Promise(r => setTimeout(r, 3300));
    }
    window.__PROG.running = false;
  })();
  return 'started';
})();
