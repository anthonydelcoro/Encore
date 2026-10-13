/* Encore — unlimited rock song guessing. Plain JS, no build step. */
(function (root) {
  'use strict';

  // ---------- Pure helpers (also used by tests) ----------
  const DIFFICULTY = {
    easy:   { label: 'Easy',   stages: [2, 4, 7, 11, 16, 24] },
    normal: { label: 'Normal', stages: [1, 2, 4, 7, 11, 16] },
    hard:   { label: 'Hard',   stages: [0.5, 1, 2, 4, 7, 11] },
  };
  const ERAS = [
    { key: '70s', label: '’60s–’70s' },
    { key: '80s', label: '’80s' },
    { key: '90s', label: '’90s' },
    { key: '00s', label: '2000s+' },
  ];

  function norm(s) {
    return String(s).toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/&/g, ' and ')
      .replace(/['’`]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  // Search the guess list. Every query word must appear at the start of a word
  // in "title artist". Titles that start with the query rank first.
  function searchSongs(list, query, limit) {
    const q = norm(query);
    if (!q) return [];
    const words = q.split(' ');
    const out = [];
    for (const s of list) {
      const t = s._nt || (s._nt = norm(s.t));
      const a = s._na || (s._na = norm(s.a));
      const hay = ' ' + t + ' ' + a;
      if (!words.every(w => hay.includes(' ' + w))) continue;
      let rank = 3;
      if (t.startsWith(q)) rank = 0;
      else if ((' ' + t).includes(' ' + q)) rank = 1;
      else if (a.startsWith(q)) rank = 2;
      out.push([rank, t.length, s]);
    }
    out.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    return out.slice(0, limit || 8).map(x => x[2]);
  }

  // 'right' | 'artist' | 'wrong'
  function judge(answer, guess) {
    if (!guess) return 'wrong';
    const sameArtist = norm(guess.a) === norm(answer.a);
    if (guess.id === answer.id) return 'right';
    if (sameArtist && norm(guess.t) === norm(answer.t)) return 'right';
    return sameArtist ? 'artist' : 'wrong';
  }

  function filterPool(songs, eras) {
    const set = new Set(eras);
    return songs.filter(s => set.has(s.e));
  }

  // Random song from pool that isn't in the recent list. If everything is
  // recent, the oldest entries free up first.
  function pickSong(pool, recent, rand) {
    rand = rand || Math.random;
    if (!pool.length) return null;
    const recentSet = new Set(recent);
    let candidates = pool.filter(s => !recentSet.has(s.id));
    if (!candidates.length) {
      const keep = new Set(recent.slice(-Math.floor(pool.length / 2)));
      candidates = pool.filter(s => !keep.has(s.id));
      if (!candidates.length) candidates = pool;
    }
    return candidates[Math.floor(rand() * candidates.length)];
  }

  function rememberPlayed(recent, id, poolSize) {
    const cap = Math.max(1, Math.floor(poolSize * 0.75));
    const next = recent.filter(x => x !== id);
    next.push(id);
    return next.slice(-cap);
  }

  function fmt(sec) {
    const s = Math.max(0, Math.floor(sec));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  const helpers = { norm, searchSongs, judge, filterPool, pickSong, rememberPlayed, fmt, DIFFICULTY, ERAS };
  if (typeof module !== 'undefined' && module.exports) { module.exports = helpers; return; }
  if (typeof document === 'undefined') return;

  // ---------- Storage (best-effort; the game works without it) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('encore.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('encore.' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  };

  // ---------- iTunes lookup (JSONP; used only to refresh a dead preview URL) ----------
  function jsonp(url, timeoutMs) {
    return new Promise((resolve, reject) => {
      const cb = '__encore' + Math.random().toString(36).slice(2);
      const s = document.createElement('script');
      const t = setTimeout(() => { done(); reject(new Error('timeout')); }, timeoutMs || 10000);
      function done() { clearTimeout(t); try { delete window[cb]; } catch (e) { window[cb] = undefined; } s.remove(); }
      window[cb] = data => { done(); resolve(data); };
      s.onerror = () => { done(); reject(new Error('network')); };
      s.src = url + (url.includes('?') ? '&' : '?') + 'callback=' + cb;
      document.head.appendChild(s);
    });
  }
  // Fill in preview URL, album, art and link for every song, in a few batched calls.
  async function hydrate(songs, onProgress) {
    const byId = new Map(songs.map(s => [s.id, s]));
    const ids = songs.map(s => s.id);
    const CHUNK = 100;
    const chunks = [];
    for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK));
    let done = 0;
    const fetchChunk = async chunk => {
      const url = 'https://itunes.apple.com/lookup?id=' + chunk.join(',') + '&country=US&entity=song';
      try { return await jsonp(url, 15000); }
      catch (e) { await new Promise(r => setTimeout(r, 1500)); return jsonp(url, 15000); }
    };
    // Parallel, but one failed chunk only loses those songs, not the whole game.
    const results = await Promise.all(chunks.map(c => fetchChunk(c).then(d => {
      done += c.length;
      if (onProgress) onProgress(done, ids.length);
      return d;
    }, () => null)));
    for (const d of results) {
      for (const r of (d && d.results) || []) {
        const s = byId.get(r.trackId);
        if (!s || !r.previewUrl) continue;
        s.p = r.previewUrl;
        s.al = r.collectionName;
        s.art = r.artworkUrl100;
        s.url = (r.trackViewUrl || '').replace(/[?&]uo=\d+/, '');
      }
    }
    return songs.filter(s => s.p);
  }
  async function refreshPreview(song) {
    const d = await jsonp('https://itunes.apple.com/lookup?id=' + song.id + '&country=US&entity=song');
    const r = d && d.results && d.results.find(x => x.trackId === song.id);
    if (!r || !r.previewUrl) throw new Error('no preview');
    song.p = r.previewUrl;
    if (r.artworkUrl100) song.art = r.artworkUrl100;
    return song.p;
  }

  // ---------- DOM ----------
  const $ = id => document.getElementById(id);
  const el = {
    guesses: $('guesses'), status: $('status'), play: $('btn-play'), audio: $('audio'),
    bar: $('bar'), fill: $('bar-fill'), unlocked: $('bar-unlocked'), ticks: $('bar-ticks'),
    tNow: $('time-now'), tMax: $('time-max'),
    input: $('guess-input'), sugg: $('suggestions'), form: $('guess-form'),
    skip: $('btn-skip'), submit: $('btn-submit'), next: $('btn-next'),
    reveal: $('reveal'), streak: $('streak'), roundNo: $('round-no'), poolLabel: $('pool-label'),
  };

  // songs.js: [trackId, era, artist, title]
  let SONGS = (root.ENCORE_SONGS || []).map(([id, e, a, t]) => ({ id, e, a, t }));
  const settings = Object.assign({ eras: ERAS.map(e => e.key), difficulty: 'normal', volume: 0.8 }, store.get('settings', {}));
  if (!DIFFICULTY[settings.difficulty]) settings.difficulty = 'normal';
  settings.eras = settings.eras.filter(e => ERAS.some(x => x.key === e));
  if (!settings.eras.length) settings.eras = ERAS.map(e => e.key);
  let stats = Object.assign({ played: 0, wins: 0, streak: 0, best: 0, dist: [0, 0, 0, 0, 0, 0, 0] }, store.get('stats', {}));
  let recent = store.get('recent', []);
  let roundNo = 0;

  const state = { song: null, stage: 0, guesses: [], done: false, won: false, ready: false, limit: 0 };
  let sugList = [], sugActive = -1, chosen = null, raf = 0;

  const stages = () => DIFFICULTY[settings.difficulty].stages;
  const maxStage = () => stages()[stages().length - 1];

  function setStatus(msg, isErr) { el.status.textContent = msg; el.status.classList.toggle('err', !!isErr); }

  function renderTicks() {
    const max = state.done ? 30 : maxStage();
    el.ticks.innerHTML = state.done ? '' : stages().slice(0, -1).map(s => `<i style="left:${(s / max) * 100}%"></i>`).join('');
  }

  function renderBar(t) {
    const max = state.done ? 30 : maxStage();
    const unlocked = state.done ? 30 : stages()[state.stage];
    el.unlocked.style.width = Math.min(100, (unlocked / max) * 100) + '%';
    el.fill.style.width = Math.min(100, ((t || 0) / max) * 100) + '%';
    el.tNow.textContent = fmt(t || 0);
    el.tMax.textContent = fmt(max);
  }

  function renderGuesses() {
    const n = stages().length;
    let html = '';
    for (let i = 0; i < n; i++) {
      const g = state.guesses[i];
      if (g) {
        const icon = g.type === 'right' ? '✓' : g.type === 'skip' ? '' : '✕';
        const text = g.type === 'skip' ? 'Skipped' : esc(g.song.t) + ' <small style="color:var(--muted)">— ' + esc(g.song.a) + '</small>';
        html += `<li class="${g.type}"><span class="tag">${icon}</span><span class="txt">${text}</span></li>`;
      } else {
        html += `<li class="${i === state.guesses.length && !state.done ? 'current' : ''}"></li>`;
      }
    }
    el.guesses.innerHTML = html;
  }

  function renderHeader() {
    el.streak.textContent = stats.streak;
    el.roundNo.textContent = Math.max(1, roundNo);
    const all = settings.eras.length === ERAS.length;
    el.poolLabel.textContent = all ? 'All eras' : ERAS.filter(e => settings.eras.includes(e.key)).map(e => e.label).join(', ');
  }

  function renderControls() {
    const playing = !el.audio.paused;
    el.play.disabled = !state.ready;
    el.play.classList.toggle('playing', playing);
    el.input.disabled = state.done || !state.song;
    el.skip.disabled = state.done || !state.song;
    el.submit.disabled = state.done || !chosen;
    el.skip.classList.toggle('hidden', state.done);
    el.submit.classList.toggle('hidden', state.done);
    el.next.classList.toggle('hidden', !state.done);
    el.input.parentElement.classList.toggle('hidden', state.done);
    if (!state.done && state.song) {
      const st = stages();
      el.skip.textContent = state.stage < st.length - 1 ? `Skip (+${+(st[state.stage + 1] - st[state.stage]).toFixed(1)}s)` : 'Give up';
    }
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // ---------- Audio ----------
  function stopAudio() {
    cancelAnimationFrame(raf);
    el.audio.pause();
    renderControls();
  }

  function tick() {
    const t = el.audio.currentTime;
    if (!state.done && t >= state.limit) {
      el.audio.pause();
      renderBar(state.limit);
      setTimeout(() => { if (el.audio.paused) renderBar(0); }, 350);
      renderControls();
      return;
    }
    renderBar(t);
    if (!el.audio.paused) raf = requestAnimationFrame(tick);
    else renderControls();
  }

  async function play() {
    if (!state.ready) return;
    if (!el.audio.paused) { stopAudio(); renderBar(0); return; }
    state.limit = state.done ? 30 : stages()[state.stage];
    try {
      el.audio.currentTime = 0;
      await el.audio.play();
      renderControls();
      raf = requestAnimationFrame(tick);
    } catch (e) {
      setStatus('Your browser blocked playback — tap play again.', true);
    }
  }

  let loadToken = 0;
  function loadAudio(song, retried) {
    const token = ++loadToken;
    state.ready = false;
    renderControls();
    setStatus('Loading clip…');
    el.audio.src = song.p;
    el.audio.load();
    el.audio.oncanplay = () => {
      if (token !== loadToken) return;
      state.ready = true;
      setStatus(state.done ? 'Press play to hear the full 30-second preview.' : 'Press play, then guess.');
      renderControls();
    };
    el.audio.onerror = async () => {
      if (token !== loadToken) return;
      if (!retried) {
        try { await refreshPreview(song); if (token === loadToken) loadAudio(song, true); return; } catch (e) { /* fall through */ }
      }
      setStatus('This clip wouldn’t load. Loading another song…', true);
      setTimeout(() => { if (token === loadToken) newRound(true); }, 1400);
    };
  }
  el.audio.onended = () => { renderBar(0); renderControls(); };
  el.audio.onpause = () => renderControls();

  // ---------- Round flow ----------
  function poolNow() { return filterPool(SONGS, settings.eras); }

  function newRound(skipCount) {
    stopAudio();
    const pool = poolNow();
    const song = pickSong(pool, recent);
    if (!song) { setStatus('No songs match your era filter. Open settings to add some.', true); return; }
    recent = rememberPlayed(recent, song.id, pool.length);
    store.set('recent', recent);
    if (!skipCount) roundNo++;
    Object.assign(state, { song, stage: 0, guesses: [], done: false, won: false, ready: false, limit: 0 });
    chosen = null;
    el.input.value = '';
    hideSugg();
    el.reveal.classList.add('hidden');
    renderHeader(); renderTicks(); renderBar(0); renderGuesses(); renderControls();
    loadAudio(song);
  }

  function advance(entry) {
    state.guesses.push(entry);
    if (entry.type === 'right') return finish(true);
    if (state.guesses.length >= stages().length) return finish(false);
    state.stage = Math.min(state.stage + 1, stages().length - 1);
    renderBar(0); renderGuesses(); renderControls();
    const add = stages()[state.stage];
    setStatus(entry.type === 'artist' ? `Right artist, wrong song. ${add}s unlocked.` : `${add}s unlocked.`);
  }

  function finish(won) {
    stopAudio();
    state.done = true; state.won = won;
    stats.played++;
    if (won) {
      stats.wins++; stats.streak++; stats.best = Math.max(stats.best, stats.streak);
      stats.dist[state.guesses.length - 1]++;
    } else {
      stats.streak = 0; stats.dist[6]++;
    }
    store.set('stats', stats);
    const s = state.song;
    $('rv-result').textContent = won ? `Got it in ${state.guesses.length}` : 'Out of guesses';
    $('rv-result').className = 'rv-result ' + (won ? 'win' : 'lose');
    $('rv-title').textContent = s.t;
    $('rv-artist').textContent = s.a;
    $('rv-meta').textContent = [s.al, s.y].filter(Boolean).join(' · ');
    $('rv-art').src = (s.art || '').replace(/100x100bb/, '300x300bb');
    $('rv-art').alt = s.al ? 'Album art for ' + s.al : '';
    $('rv-link').href = s.url || ('https://music.apple.com/us/search?term=' + encodeURIComponent(s.a + ' ' + s.t));
    el.reveal.classList.remove('hidden');
    renderHeader(); renderTicks(); renderBar(0); renderGuesses(); renderControls();
    setStatus('Press play for the full 30-second preview.');
    el.next.focus();
  }

  // ---------- Suggestions ----------
  function hideSugg() { el.sugg.classList.add('hidden'); sugList = []; sugActive = -1; el.input.setAttribute('aria-expanded', 'false'); }
  function highlight(text, q) {
    const words = norm(q).split(' ').filter(Boolean);
    let out = esc(text);
    for (const w of words) {
      const re = new RegExp('(^|[^a-z0-9])(' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'i');
      out = out.replace(re, '$1<mark>$2</mark>');
    }
    return out;
  }
  function showSugg() {
    const q = el.input.value;
    sugList = searchSongs(SONGS, q, 8);
    chosen = null;
    if (sugList.length) {
      const exact = sugList.find(s => norm(s.t + ' ' + s.a) === norm(q) || norm(s.t + ' — ' + s.a) === norm(q));
      if (exact) chosen = exact;
    }
    if (!sugList.length) { hideSugg(); renderControls(); return; }
    sugActive = 0;
    el.sugg.innerHTML = sugList.map((s, i) =>
      `<li role="option" data-i="${i}" class="${i === sugActive ? 'active' : ''}">${highlight(s.t, q)} <small>— ${highlight(s.a, q)}</small></li>`).join('');
    el.sugg.classList.remove('hidden');
    el.input.setAttribute('aria-expanded', 'true');
    renderControls();
  }
  function setActive(i) {
    sugActive = (i + sugList.length) % sugList.length;
    [...el.sugg.children].forEach((li, j) => li.classList.toggle('active', j === sugActive));
    el.sugg.children[sugActive].scrollIntoView({ block: 'nearest' });
  }
  function choose(song) {
    chosen = song;
    el.input.value = song.t + ' — ' + song.a;
    hideSugg();
    renderControls();
  }

  el.input.addEventListener('input', showSugg);
  el.input.addEventListener('keydown', e => {
    if (el.sugg.classList.contains('hidden')) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(sugActive + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(sugActive - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); if (sugList[sugActive]) choose(sugList[sugActive]); }
    else if (e.key === 'Escape') { hideSugg(); }
  });
  el.input.addEventListener('blur', () => setTimeout(hideSugg, 150));
  el.sugg.addEventListener('mousedown', e => {
    const li = e.target.closest('li');
    if (li) { e.preventDefault(); choose(sugList[+li.dataset.i]); }
  });

  el.form.addEventListener('submit', e => {
    e.preventDefault();
    if (state.done || !chosen) return;
    const g = chosen;
    if (state.guesses.some(x => x.song && x.song.id === g.id)) { setStatus('You already tried that one.', true); return; }
    chosen = null;
    el.input.value = '';
    stopAudio();
    advance({ type: judge(state.song, g), song: g });
  });
  el.skip.addEventListener('click', () => { if (!state.done) { stopAudio(); advance({ type: 'skip' }); } });
  el.next.addEventListener('click', () => newRound());
  el.play.addEventListener('click', play);

  document.addEventListener('keydown', e => {
    if (document.querySelector('dialog[open]')) return;
    const typing = document.activeElement === el.input;
    if (e.key === ' ' && !typing) { e.preventDefault(); play(); }
    if (e.key === 'Enter' && state.done && !typing && document.activeElement !== el.next) { e.preventDefault(); newRound(); }
  });

  // ---------- Dialogs ----------
  function open(id) { const d = $(id); if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', ''); }
  $('btn-help').onclick = () => open('dlg-help');
  $('btn-stats').onclick = () => { renderStats(); open('dlg-stats'); };
  $('btn-settings').onclick = () => { renderSettings(); open('dlg-settings'); };

  function renderStats() {
    $('st-played').textContent = stats.played;
    $('st-win').textContent = stats.played ? Math.round((stats.wins / stats.played) * 100) : 0;
    $('st-streak').textContent = stats.streak;
    $('st-best').textContent = stats.best;
    const max = Math.max(1, ...stats.dist);
    $('st-dist').innerHTML = stats.dist.map((n, i) =>
      `<div class="dist-row"><span>${i < 6 ? i + 1 : '✕'}</span><div><span class="b ${state.done && ((state.won && i === state.guesses.length - 1) || (!state.won && i === 6)) ? 'hi' : ''}" style="display:inline-block;width:${Math.max(8, (n / max) * 100)}%">${n}</span></div></div>`).join('');
  }
  $('btn-reset').onclick = () => {
    if (!stats.played || window.confirm('Reset all stats?')) {
      stats = { played: 0, wins: 0, streak: 0, best: 0, dist: [0, 0, 0, 0, 0, 0, 0] };
      store.set('stats', stats); renderStats(); renderHeader();
    }
  };

  function renderSettings() {
    $('era-chips').innerHTML = ERAS.map(e => `<button type="button" class="chip" data-era="${e.key}" aria-pressed="${settings.eras.includes(e.key)}">${e.label}</button>`).join('');
    $('diff-chips').innerHTML = Object.entries(DIFFICULTY).map(([k, d]) => `<button type="button" class="chip" data-diff="${k}" aria-pressed="${settings.difficulty === k}">${d.label} <small>(${d.stages[0]}s start)</small></button>`).join('');
    $('era-count').textContent = poolNow().length + ' songs in the mix';
    $('volume').value = settings.volume;
  }
  $('era-chips').addEventListener('click', e => {
    const b = e.target.closest('[data-era]'); if (!b) return;
    const k = b.dataset.era;
    const next = settings.eras.includes(k) ? settings.eras.filter(x => x !== k) : settings.eras.concat(k);
    if (!next.length) return; // keep at least one era
    settings.eras = next; store.set('settings', settings); renderSettings(); renderHeader();
  });
  $('diff-chips').addEventListener('click', e => {
    const b = e.target.closest('[data-diff]'); if (!b) return;
    settings.difficulty = b.dataset.diff; store.set('settings', settings); renderSettings();
    if (!state.done) { stopAudio(); renderTicks(); renderBar(0); renderGuesses(); renderControls(); }
  });
  $('volume').addEventListener('input', e => { settings.volume = +e.target.value; el.audio.volume = settings.volume; store.set('settings', settings); });
  $('dlg-settings').addEventListener('close', () => {
    // New era filter applies to the next song; if the current one is now excluded and untouched, swap it.
    if (state.song && !state.done && !state.guesses.length && !settings.eras.includes(state.song.e)) newRound(true);
  });

  // ---------- Start ----------
  el.audio.volume = settings.volume;
  if (!SONGS.length) { setStatus('Song list failed to load.', true); return; }
  if (!store.get('seenHelp', false)) { store.set('seenHelp', true); open('dlg-help'); }

  async function start() {
    setStatus('Tuning up…');
    el.play.onclick = null;
    try {
      const ready = await hydrate(SONGS, (d, n) => setStatus(`Tuning up… ${Math.round((d / n) * 100)}%`));
      if (!ready.length) throw new Error('empty');
      SONGS = ready;
      newRound();
    } catch (e) {
      setStatus('Couldn’t reach Apple’s preview service. Check your connection, then tap play to retry.', true);
      el.play.disabled = false;
      el.play.onclick = ev => { ev.stopImmediatePropagation(); start(); };
    }
  }
  start();
})(typeof window !== 'undefined' ? window : globalThis);
