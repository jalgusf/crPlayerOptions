// Subtitle "None" option via network injection.
// ---------------------------------------------------------------------------
// Crunchyroll builds its subtitle-language menu from a JSON file it fetches:
//   https://static.crunchyroll.com/config/i18n/v3/timed_text_languages.json
// which maps locale -> display name, e.g. { "en-US": "English", ... }.
//
// We intercept that response with Firefox's filterResponseData and prepend a
// "None" entry, so it shows up as a native option in the player menu. Selecting
// it asks the player for a locale that has no timed-text track, which leaves the
// video with no subtitles rendered.
// ---------------------------------------------------------------------------

const NONE_KEY = 'off'; // locale key with no real subtitle track => no subs
const NONE_LABEL = 'None';

const LANG_URLS = [
  '*://static.crunchyroll.com/config/i18n/*/timed_text_languages.json*',
];

function injectNone(details) {
  const filter = browser.webRequest.filterResponseData(details.requestId);
  const decoder = new TextDecoder('utf-8');
  const encoder = new TextEncoder();
  const chunks = [];

  filter.ondata = (event) => {
    chunks.push(decoder.decode(event.data, { stream: true }));
  };

  filter.onstop = () => {
    let text = chunks.join('') + decoder.decode();
    try {
      const langs = JSON.parse(text);
      if (langs && typeof langs === 'object' && !(NONE_KEY in langs)) {
        // Rebuild the object with "None" first so it sits at the top of the menu.
        const merged = { [NONE_KEY]: NONE_LABEL };
        for (const key in langs) merged[key] = langs[key];
        text = JSON.stringify(merged);
      }
    } catch (e) {
      /* not JSON we understand — pass it through untouched */
    }
    filter.write(encoder.encode(text));
    filter.close();
  };

  filter.onerror = () => {
    try {
      filter.disconnect();
    } catch (e) {
      /* nothing we can do */
    }
  };
}

browser.webRequest.onBeforeRequest.addListener(
  injectNone,
  { urls: LANG_URLS },
  ['blocking']
);
