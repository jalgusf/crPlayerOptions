// Subtitle "None" option via network injection.
// ---------------------------------------------------------------------------
// Crunchyroll builds its subtitle menu from the per-episode playback response:
//   https://www.crunchyroll.com/playback/v3/<id>/web/<browser>/play
// whose `subtitles` field maps locale -> { format, language, url }. We inject a
// "None" entry pointing at an empty subtitle track (a data: URL with no dialogue
// lines), so it appears as a native menu option and selecting it renders no
// subtitles.
//
// The menu *label* for a locale is looked up in a separate file:
//   https://static.crunchyroll.com/config/i18n/v3/timed_text_languages.json
// a locale -> name map. We add our locale there too, so the row reads "None".
//
// Both responses are rewritten on the fly with Firefox's filterResponseData.
// ---------------------------------------------------------------------------

const NONE_KEY = 'off'; // locale key for our injected entry
const NONE_LABEL = 'None';

// A minimal, valid ASS file with a style but zero dialogue events: parses fine
// and draws nothing on screen. Delivered inline so no network request is made.
const EMPTY_ASS = [
  '[Script Info]',
  'ScriptType: v4.00+',
  '',
  '[V4+ Styles]',
  'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
  'Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1',
  '',
  '[Events]',
  'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  '',
].join('\n');
const EMPTY_ASS_URL =
  'data:text/plain;charset=utf-8,' + encodeURIComponent(EMPTY_ASS);

// Rewrite a JSON response body: `transform(json)` may mutate and return the new
// object (or return undefined to leave the body untouched).
function filterJson(details, transform) {
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
      const out = transform(JSON.parse(text));
      if (out !== undefined) text = JSON.stringify(out);
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

// Add "None" to the per-episode subtitle list (drives the menu row + track).
function addNoneSubtitle(json) {
  const subs = json && json.subtitles;
  if (!subs || typeof subs !== 'object' || NONE_KEY in subs) return;
  const none = { format: 'ass', language: NONE_KEY, url: EMPTY_ASS_URL };
  json.subtitles = { [NONE_KEY]: none, ...subs }; // put "None" first
  return json;
}

// Add the display name for our locale (drives the menu label).
function addNoneLabel(json) {
  if (!json || typeof json !== 'object' || NONE_KEY in json) return;
  return { [NONE_KEY]: NONE_LABEL, ...json };
}

browser.webRequest.onBeforeRequest.addListener(
  (d) => filterJson(d, addNoneSubtitle),
  { urls: ['*://www.crunchyroll.com/playback/v3/*/play*'] },
  ['blocking']
);

browser.webRequest.onBeforeRequest.addListener(
  (d) => filterJson(d, addNoneLabel),
  { urls: ['*://static.crunchyroll.com/config/i18n/*/timed_text_languages.json*'] },
  ['blocking']
);
