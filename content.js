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
  let subsOff = false; // whether "None" subtitles is active
  const hiddenNodes = new Map(); // node -> previous inline display value

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

  // Move the player's "selected" indicator onto `chosen`. The marker can be an
  // aria attribute, a CSS class present on only the selected item, or a child
  // element (a checkmark icon). We detect whichever it is and relocate it.
  function syncSelection(parent, classify, chosen) {
    const items = Array.from(parent.querySelectorAll(ITEM_SEL)).filter(
      (n) => n.hasAttribute(FLAG) || classify(textOf(n)) !== null
    );
    if (!items.includes(chosen)) items.push(chosen);

    // 1) aria-checked
    for (const el of items)
      if (el.hasAttribute('aria-checked'))
        el.setAttribute('aria-checked', el === chosen ? 'true' : 'false');

    // 2) a selection-ish class carried by exactly one item
    const freq = new Map();
    for (const el of items)
      for (const c of el.classList) freq.set(c, (freq.get(c) || 0) + 1);
    const selClasses = [...freq.entries()]
      .filter(
        ([c, n]) =>
          n < items.length &&
          /(select|activ|current|checked|highlight)/i.test(c)
      )
      .map(([c]) => c);
    if (selClasses.length) {
      for (const el of items) el.classList.remove(...selClasses);
      chosen.classList.add(...selClasses);
    }

    // 3) a checkmark child element that lives inside the selected item only
    const MARK_SEL =
      '[class*="check" i], [class*="tick" i], [class*="selected" i], [class*="active" i]';
    for (const el of items) {
      if (el === chosen) continue;
      const mark = el.querySelector(MARK_SEL);
      if (mark && !chosen.querySelector(MARK_SEL)) {
        chosen.appendChild(mark);
        break;
      }
    }
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
        syncSelection(group.parent, classifySpeed, item);
      });
      group.parent.appendChild(item);
    }

    // Re-assert our selection whenever Crunchyroll rebuilds the menu, so the
    // checkmark keeps pointing at the speed the user actually chose.
    if (desiredRate != null) {
      const chosen =
        group.parent.querySelector(`[${FLAG}="speed-${desiredRate}"]`) ||
        group.items.find((i) => Math.abs(i.value - desiredRate) < 1e-9)?.node;
      if (chosen) syncSelection(group.parent, classifySpeed, chosen);
    }

    // Keep the chosen speed applied when Crunchyroll rebuilds the media.
    guardVideoRate();
  }

  // --- Subtitles ----------------------------------------------------------
  function classifySubtitle(text) {
    if (LANG_RE.test(text)) return text;
    if (OFF_RE.test(text)) return text; // existing off entry
    return null;
  }

  // Crunchyroll renders subtitles into an overlay/canvas layered over the
  // <video> (its exact class names change), so instead of guessing selectors we
  // find likely subtitle layers at runtime and hide them directly. This is
  // re-run on every scan while "None" is active, since the player recreates the
  // layer on seeks / new segments.
  function subtitleLayers() {
    const sel =
      'canvas, [class*="subtitle" i], [class*="caption" i], [class*="timedtext" i], [class*="libass" i], .vjs-text-track-display';
    return Array.from(document.querySelectorAll(sel)).filter(
      (n) =>
        // never hide the controls: skip anything that is (or sits inside) a
        // button or an open menu.
        !n.closest(
          'button, [role="menu"], [role="menuitem"], [role="menuitemradio"], [role="option"]'
        )
    );
  }

  function applySubtitleState() {
    if (subsOff) {
      for (const n of subtitleLayers()) {
        if (!hiddenNodes.has(n)) hiddenNodes.set(n, n.style.display);
        n.style.setProperty('display', 'none', 'important');
      }
    } else if (hiddenNodes.size) {
      for (const [n, prev] of hiddenNodes) n.style.display = prev || '';
      hiddenNodes.clear();
    }
    const v = getVideo();
    if (subsOff && v && v.textTracks)
      for (const track of v.textTracks) track.mode = 'disabled';
  }

  function setSubtitlesOff(off) {
    subsOff = off;
    applySubtitleState();
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
      syncSelection(group.parent, classifySubtitle, item);
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
      injectSpeeds();
      injectSubtitleNone();
      if (subsOff) applySubtitleState(); // re-hide layers the player recreated
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
