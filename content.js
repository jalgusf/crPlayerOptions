// Crunchyroll Player Options
// --------------------------------------------------------------------------
// Injects extra playback-speed options (1.5x, 2x) and a "None" subtitle
// option into the Crunchyroll player's own settings menu.
//
// Crunchyroll's markup is minified and its class names change often, so we do
// NOT rely on hard-coded selectors. Instead we find the speed / subtitle menus
// by looking at the *text* of their option items, then clone an existing item
// so injected options inherit the native styling. That makes this resilient to
// Crunchyroll's frequent DOM changes.
// --------------------------------------------------------------------------

(() => {
  'use strict';

  // --- Config -------------------------------------------------------------
  const EXTRA_SPEEDS = [1.5, 2]; // speeds to add to the playback-speed menu
  const FLAG = 'data-crpo'; // marks nodes we injected, so we never double-add

  // Matches a speed label like "1.25x", "2 x", "1.5×".
  const SPEED_RE = /^(\d+(?:\.\d+)?)\s*[x×]$/i;
  // A menu item that means "normal speed" (value 1).
  const NORMAL_RE = /^(normal|default|1\.0|1)$/i;

  // Language names commonly seen in the subtitle menu. Used only to *locate*
  // the subtitle list; adding to this list only improves detection.
  const LANG_RE = /^(english|espa(ñ|n)ol|fran(ç|c)ais|portugu(ê|e)s|deutsch|italiano|русский|العربية|日本語|한국어|中文|繁體中文|简体中文|t(ü|u)rk(ç|c)e|polski|nederlands|indonesia|ti(ế|e)ng vi(ệ|e)t|espa(ñ|n)ol\s*\(.*\)|portugu(ê|e)s\s*\(.*\))/i;
  // Existing "off" style entries so we don't add a duplicate "None".
  const OFF_RE = /^(none|off|no subtitles|disabled?)$/i;

  // Selector for interactive menu items across the player's various menus.
  const ITEM_SEL =
    'button, [role="menuitem"], [role="menuitemradio"], [role="option"], [role="radio"], li';

  // --- State --------------------------------------------------------------
  let desiredRate = null; // last speed the user picked via our options

  // --- Styles for hiding subtitles when "None" is chosen ------------------
  const SUBS_OFF_CLASS = 'crpo-subs-off';
  function injectStyle() {
    if (document.getElementById('crpo-style')) return;
    const style = document.createElement('style');
    style.id = 'crpo-style';
    style.textContent = `
      html.${SUBS_OFF_CLASS} canvas.libassjs-canvas,
      html.${SUBS_OFF_CLASS} .libassjs-canvas-parent,
      html.${SUBS_OFF_CLASS} .vjs-text-track-display,
      html.${SUBS_OFF_CLASS} [class*="subtitleContainer"],
      html.${SUBS_OFF_CLASS} [class*="subtitle-container"],
      html.${SUBS_OFF_CLASS} [class*="SubtitleRenderer"] {
        display: none !important;
        visibility: hidden !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  // --- Helpers ------------------------------------------------------------
  function getVideo() {
    return document.querySelector('video');
  }

  function textOf(el) {
    return (el.textContent || '').trim();
  }

  function setLabel(el, label) {
    el.textContent = label;
  }

  // Crunchyroll ships some option items (e.g. the speed buttons) already in the
  // DOM but disabled, which is why the browser swallows clicks on our clones.
  // Force the clone (and its descendants) back to a clickable state.
  function enableClone(el) {
    for (const node of [el, ...el.querySelectorAll('*')]) {
      node.removeAttribute('disabled');
      if ('disabled' in node) node.disabled = false;
      node.removeAttribute('aria-disabled');
      if (node.classList)
        for (const cls of [...node.classList])
          if (/disabled/i.test(cls)) node.classList.remove(cls);
      node.style.pointerEvents = 'auto';
      node.style.cursor = 'pointer';
      node.style.opacity = '';
    }
  }

  // Fire `handler` on click AND pointerup, so a native capture-phase handler
  // that swallows the click can't stop us. Guard against double-firing.
  function onActivate(el, handler) {
    let busy = false;
    const wrapped = (e) => {
      if (busy) return;
      busy = true;
      setTimeout(() => (busy = false), 0);
      handler(e);
    };
    el.addEventListener('click', wrapped, true);
    el.addEventListener('pointerup', wrapped, true);
  }

  // Group option items by their parent container, keeping only items whose
  // text passes `classify`. Returns the parent group with the most matches.
  function bestGroup(classify) {
    const groups = new Map();
    for (const node of document.querySelectorAll(ITEM_SEL)) {
      const value = classify(textOf(node));
      if (value === null) continue;
      const parent = node.parentElement;
      if (!parent) continue;
      let arr = groups.get(parent);
      if (!arr) groups.set(parent, (arr = []));
      arr.push({ node, value });
    }
    let best = null;
    for (const [parent, items] of groups) {
      if (items.length < 2) continue; // a real list has 2+ options
      if (!best || items.length > best.items.length) best = { parent, items };
    }
    return best;
  }

  // --- Playback speed -----------------------------------------------------
  function classifySpeed(text) {
    const m = text.match(SPEED_RE);
    if (m) return parseFloat(m[1]);
    if (NORMAL_RE.test(text)) return 1;
    return null;
  }

  function applyRate(rate) {
    desiredRate = rate;
    const v = getVideo();
    if (v) v.playbackRate = rate;
  }

  // Crunchyroll resets playbackRate on ad / segment boundaries; reapply the
  // chosen rate when the media reloads so the selection sticks.
  const guarded = new WeakSet();
  function guardVideoRate() {
    const v = getVideo();
    if (!v || guarded.has(v)) return;
    guarded.add(v);
    const reapply = () => {
      if (desiredRate && Math.abs(v.playbackRate - desiredRate) > 0.001) {
        v.playbackRate = desiredRate;
      }
    };
    ['loadeddata', 'play', 'playing', 'seeked'].forEach((ev) =>
      v.addEventListener(ev, reapply)
    );
  }

  function markSelected(group, chosen) {
    for (const { node } of group.items) {
      if (node.hasAttribute('aria-checked'))
        node.setAttribute('aria-checked', node === chosen ? 'true' : 'false');
    }
    if (chosen.hasAttribute('aria-checked'))
      chosen.setAttribute('aria-checked', 'true');
  }

  function injectSpeeds() {
    const group = bestGroup(classifySpeed);
    if (!group) return;
    const present = new Set(group.items.map((i) => i.value));
    const template = group.items[group.items.length - 1].node;

    for (const speed of EXTRA_SPEEDS) {
      if (present.has(speed)) continue;
      if (group.parent.querySelector(`[${FLAG}="speed-${speed}"]`)) continue;

      const item = template.cloneNode(true);
      item.setAttribute(FLAG, `speed-${speed}`);
      item.removeAttribute('id');
      enableClone(item);
      setLabel(item, `${speed}x`);
      if (item.hasAttribute('aria-checked'))
        item.setAttribute('aria-checked', 'false');
      onActivate(item, () => {
        applyRate(speed);
        markSelected(group, item);
      });
      group.parent.appendChild(item);
    }

    // Keep the chosen speed marked when Crunchyroll rebuilds the menu.
    guardVideoRate();
  }

  // --- Subtitles ----------------------------------------------------------
  function classifySubtitle(text) {
    if (LANG_RE.test(text)) return text;
    if (OFF_RE.test(text)) return text; // existing off entry
    return null;
  }

  function setSubtitlesOff(off) {
    document.documentElement.classList.toggle(SUBS_OFF_CLASS, off);
    const v = getVideo();
    if (v && v.textTracks) {
      for (const track of v.textTracks) {
        if (off) track.mode = 'disabled';
      }
    }
  }

  function injectSubtitleNone() {
    const group = bestGroup(classifySubtitle);
    if (!group) return;
    // If the menu already offers an off/none option, leave it alone.
    if (group.items.some((i) => OFF_RE.test(i.value))) return;
    if (group.parent.querySelector(`[${FLAG}="subs-none"]`)) return;

    const template = group.items[group.items.length - 1].node;
    const item = template.cloneNode(true);
    item.setAttribute(FLAG, 'subs-none');
    item.removeAttribute('id');
    enableClone(item);
    setLabel(item, 'None');
    if (item.hasAttribute('aria-checked'))
      item.setAttribute('aria-checked', 'false');
    onActivate(item, () => {
      setSubtitlesOff(true);
      markSelected(group, item);
    });

    // Picking any real language turns subtitles back on.
    for (const { node } of group.items) {
      node.addEventListener('click', () => setSubtitlesOff(false), true);
    }

    // Insert "None" at the top of the list so it reads like a natural option.
    group.parent.insertBefore(item, group.parent.firstChild);
  }

  // --- Run loop -----------------------------------------------------------
  // Menus are (re)built each time they open, so we rescan on DOM changes,
  // throttled to once per animation frame.
  let scheduled = false;
  function scan() {
    scheduled = false;
    try {
      injectStyle();
      injectSpeeds();
      injectSubtitleNone();
    } catch (e) {
      /* never let the site break because of us */
    }
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(scan);
  }

  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  schedule();
})();
