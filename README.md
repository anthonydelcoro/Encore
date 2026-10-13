# Encore

An unlimited guess-the-rock-song game, like Songless or Heardle with no daily limit. It's plain HTML, CSS and JS, with no build step and no server, so it runs on GitHub Pages as-is.

## How it works

- `songs.js` lists 265 rock songs as `[Apple track ID, era, artist, title]`. Each was matched to its studio recording on Apple Music, and live, acoustic, demo and cover versions were filtered out.
- On page load, the game asks Apple's public [iTunes Search API](https://performance-partners.apple.com/search-api) `lookup` endpoint for those IDs in 3 batched requests sent in parallel. Each result includes a 30-second `previewUrl`, which plays in a normal `<audio>` element.
- Requests use the API's documented `callback` (JSONP) mode instead of `fetch`. Apple's CORS headers are inconsistent for browser `fetch` calls, and JSONP avoids that problem.
- If a preview link has gone stale, the game looks that one song up again. If it still won't load, it skips to another song.
- Stats, settings and a "recently played" list are saved in `localStorage`, so songs don't repeat until most of the pool has been played.

## Run locally

Opening `index.html` directly works. Serving the folder works too:

```
python -m http.server 8000
```

## Deploy to GitHub Pages

1. Create a new repo, e.g. `encore`, and push these files to `main`. The `tools/` folder is optional.
2. In the repo, open **Settings → Pages → Build and deployment**, set **Source: Deploy from a branch** and **Branch: `main` / `/ (root)`**, then save.
3. After a minute the site is live at `https://<username>.github.io/encore/`.

## Adding songs

Add a line to `songs.js`:

```js
[trackId, "90s", "Artist", "Title"],
```

`era` is one of `70s` (which includes the '60s), `80s`, `90s` or `00s` (2000 onward). To find the track ID, open the song on Apple Music and use the "Share → Copy Link" URL, which ends in `?i=<trackId>`. Pick the original studio album version, not a live or acoustic one.

`tools/seed-songs.txt`, `tools/ids.txt` and `tools/build-songs.py` are how the starting list was built, and they're kept for reference.

Some well-known songs, like *Killing in the Name*, *Creep* and *American Idiot*, aren't included because Apple's US store had no studio-version preview for them when the list was built.

## Limits

- Apple's search API allows roughly 20 requests per minute per visitor. The game uses about 3 per page load.
- Apple's 30-second previews usually start partway into the song, often at the chorus, not at the intro.
- Apple's terms say previews are meant to promote the music on its store, and they ask for attribution and a link to the store. The game links every song to Apple Music after each round and credits iTunes in the footer. It's fine for a personal fan project, but don't monetize it.

## Tests

```
node tools/test-logic.js
```
