(() => {
  "use strict";
  const allowed = [1, 1.5, 2];
  let speed = 1;
  let revision = 0;
  function apply() {
    for (const video of document.querySelectorAll("video")) {
      try {
        video.preservesPitch = true;
        if (video.defaultPlaybackRate !== speed) video.defaultPlaybackRate = speed;
        if (video.playbackRate !== speed) video.playbackRate = speed;
      } catch (_) { /* A player may be unloading; retry on the next tick. */ }
    }
  }
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.speed) return;
    revision++;
    speed = allowed.includes(changes.speed.newValue) ? changes.speed.newValue : 1;
    apply();
  });
  const initialRevision = revision;
  browser.storage.local.get("speed").then(saved => {
    if (revision === initialRevision) speed = allowed.includes(saved.speed) ? saved.speed : 1;
    apply();
  }).catch(() => {});
  document.addEventListener("loadedmetadata", apply, true);
  document.addEventListener("play", apply, true);
  // Bounded polling handles episode changes and player resets without a ratechange loop.
  setInterval(apply, 1000);
})();
