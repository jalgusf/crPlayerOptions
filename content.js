// Crunchyroll Player Options — playback speed
// --------------------------------------------------------------------------
// Adds extra playback-speed options (1.5x, 2x) to the Crunchyroll player's own
// settings menu. (The "None" subtitle option is handled separately, by network
// injection in background.js.)
//
// Crunchyroll's markup is minified and its class names change often, so we do
// NOT rely on hard-coded selectors. We find the speed menu by the *text* of its
// option items, then clone an existing item so injected options inherit the
// native styling.
// --------------------------------------------------------------------------

(() => {
  'use strict';

  // --- Config -------------------------------------------------------------
  const EXTRA_SPEEDS = [1.5, 2]; // speeds to add to the playback-speed menu
  const FLAG = 'data-crpo'; // marks nodes we injected, so we never double-add

  const SPEED_RE = /^(\d+(?:\.\d+)?)\s*[x×]$/i; // "1.25x", "2 x", "1.5×"
  const NORMAL_RE = /^(normal|default|1\.0|1)$/i; // means value 1

  const ITEM_SEL =
    'button, [role="menuitem"], [role="menuitemradio"], [role="option"], [role="radio"], li';

  // --- State --------------------------------------------------------------
  let desiredRate = null; // last speed the user picked via our options

  // --- Helpers ------------------------------------------------------------
  const getVideo = () => document.querySelector('video');
  const textOf = (el) => (el.textContent || '').trim();
  const setLabel = (el, label) => (el.textContent = label);

  // Crunchyroll ships some option items already in the DOM but disabled, which
  // is why the browser swallows clicks on our clones. Force the clone (and its
  // descendants) back to a clickable state.
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
  // that swallows the click can't stop us. De-duped so it only runs once.
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

  // Group option items by parent, keeping only items whose text passes
  // `classify`. Returns the parent group with the most matches.
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
      if (desiredRate && Math.abs(v.playbackRate - desiredRate) > 0.001)
        v.playbackRate = desiredRate;
    };
    ['loadeddata', 'play', 'playing', 'seeked'].forEach((ev) =>
      v.addEventListener(ev, reapply)
    );
  }

  // Move the player's "selected" indicator onto `chosen`: the marker can be an
  // aria attribute, a CSS class only the selected item carries, or a checkmark
  // child element. We detect whichever it is and relocate it.
  function syncSelection(parent, classify, chosen) {
    const items = Array.from(parent.querySelectorAll(ITEM_SEL)).filter(
      (n) => n.hasAttribute(FLAG) || classify(textOf(n)) !== null
    );
    if (!items.includes(chosen)) items.push(chosen);

    for (const el of items)
      if (el.hasAttribute('aria-checked'))
        el.setAttribute('aria-checked', el === chosen ? 'true' : 'false');

    const freq = new Map();
    for (const el of items)
      for (const c of el.classList) freq.set(c, (freq.get(c) || 0) + 1);
    const selClasses = [...freq.entries()]
      .filter(
        ([c, n]) =>
          n < items.length && /(select|activ|current|checked|highlight)/i.test(c)
      )
      .map(([c]) => c);
    if (selClasses.length) {
      for (const el of items) el.classList.remove(...selClasses);
      chosen.classList.add(...selClasses);
    }

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

    // Re-assert our selection whenever Crunchyroll rebuilds the menu.
    if (desiredRate != null) {
      const chosen =
        group.parent.querySelector(`[${FLAG}="speed-${desiredRate}"]`) ||
        group.items.find((i) => Math.abs(i.value - desiredRate) < 1e-9)?.node;
      if (chosen) syncSelection(group.parent, classifySpeed, chosen);
    }

    guardVideoRate();
  }

  // --- Run loop -----------------------------------------------------------
  // Menus are (re)built each time they open, so we rescan on DOM changes,
  // throttled to once per animation frame.
  let scheduled = false;
  function scan() {
    scheduled = false;
    try {
      injectSpeeds();
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
