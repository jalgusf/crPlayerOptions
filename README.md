# Crunchyroll Player Options

A tiny Firefox add-on that adds two things to the Crunchyroll video player:

- **1.5x** and **2x** entries in the playback-speed menu.
- A **None** entry in the subtitle menu (turns subtitles off).

Inspired by [croptix](https://github.com/stratumadev/croptix), but deliberately
kept to two small files.

## How it works

The two features use two different, deliberately simple mechanisms.

**Playback speed — `content.js` (DOM injection).**
Crunchyroll's player markup is minified and its class names change frequently,
so this does **not** depend on hard-coded selectors. It finds the speed menu by
looking for option items whose text looks like a speed (`1x`, `1.25x`,
`Normal`, …), then clones an existing item so the new `1.5x` / `2x` options
inherit the player's native styling. Clicking one sets `video.playbackRate`
directly and re-applies it after ads / segment changes. It runs in a
`MutationObserver` (throttled to one animation frame) so the options are
re-injected whenever the menu reopens.

**Subtitle "None" — `background.js` (network injection).**
Crunchyroll builds its subtitle menu from the per-episode playback response
(`www.crunchyroll.com/playback/v3/<id>/web/<browser>/play`), whose `subtitles`
field maps each locale to a subtitle track. Using Firefox's
`webRequest.filterResponseData`, the background script injects a `None` entry
pointing at an **empty** ASS subtitle (an inline `data:` URL with no dialogue),
so it shows up as a native menu option and selecting it renders nothing. It also
adds the matching display name to the label file
(`static.crunchyroll.com/config/i18n/v3/timed_text_languages.json`) so the row
reads "None".

## Install (temporary, for testing)

1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Click **Load Temporary Add-on…**.
3. Select `manifest.json` from this folder.
4. Open any Crunchyroll episode and open the player's settings/subtitle menus.

Temporary add-ons are removed when Firefox restarts. To install permanently you
need to sign the add-on through [addons.mozilla.org](https://addons.mozilla.org).

## Files

| File            | Purpose                                              |
| --------------- | ---------------------------------------------------- |
| `manifest.json` | Add-on metadata, permissions, script registration (MV2). |
| `content.js`    | Playback-speed injection (DOM).                      |
| `background.js` | Subtitle "None" injection (rewrites the language JSON). |

## Tweaking

- `EXTRA_SPEEDS` (top of `content.js`) — which speeds to add.
- `SPEED_RE` / `NORMAL_RE` (top of `content.js`) — how speed options are recognised.
- `NONE_KEY` / `NONE_LABEL` (top of `background.js`) — the injected subtitle
  entry's locale key and label.
- `LANG_URLS` (top of `background.js`) — which response(s) get the `None` entry.
