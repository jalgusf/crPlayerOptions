# Crunchyroll Player Options

A tiny Firefox add-on that adds two things to the Crunchyroll video player:

- **1.5x** and **2x** entries in the playback-speed menu.
- A **None** entry in the subtitle menu (turns subtitles off).

Inspired by [croptix](https://github.com/stratumadev/croptix), but deliberately
kept to two small files.

## How it works

Crunchyroll's player markup is minified and its class names change frequently,
so this add-on does **not** depend on hard-coded selectors. `content.js`:

1. Finds the speed menu by looking for option items whose text looks like a
   speed (`1x`, `1.25x`, `Normal`, …), then clones an existing item so the new
   `1.5x` / `2x` options inherit the player's native styling. Clicking one sets
   `video.playbackRate` directly and re-applies it after ads / segment changes.
2. Finds the subtitle menu the same way (option items whose text is a language
   name) and adds a **None** option that hides the subtitle layer. Picking any
   real language turns subtitles back on.

Everything runs in a `MutationObserver`, throttled to once per animation frame,
so options are re-injected whenever the menu is reopened.

## Install (temporary, for testing)

1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Click **Load Temporary Add-on…**.
3. Select `manifest.json` from this folder.
4. Open any Crunchyroll episode and open the player's settings/subtitle menus.

Temporary add-ons are removed when Firefox restarts. To install permanently you
need to sign the add-on through [addons.mozilla.org](https://addons.mozilla.org).

## Files

| File           | Purpose                                             |
| -------------- | --------------------------------------------------- |
| `manifest.json`| Add-on metadata + content-script registration (MV2).|
| `content.js`   | All of the logic described above.                   |

## Tweaking

If Crunchyroll changes something and detection misses, the knobs are all at the
top of `content.js`:

- `EXTRA_SPEEDS` — which speeds to add.
- `SPEED_RE` / `NORMAL_RE` — how speed options are recognised.
- `LANG_RE` / `OFF_RE` — how subtitle options are recognised.
- The `html.crpo-subs-off …` CSS block — which layers get hidden for "None".
