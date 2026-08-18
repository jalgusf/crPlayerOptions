// Subtitle "None" option via network injection.
// ---------------------------------------------------------------------------
// Crunchyroll builds its subtitle language menu from the per-episode playback
// response:
//   https://www.crunchyroll.com/playback/v3/<id>/web/<browser>/play
// The player labels each row from the locale key (falling back to the raw key
// when it has no display name for it), so we use "None" as the key itself and
// the menu reads "None".
//
// We add the entry to `hardSubs` (the burned-in stream variants the menu is
// built from), pointing it at the clean, subtitle-free manifest already present
// in the response (top-level `url`) so selecting it plays the video with no
// subtitles. We also add it to the soft `subtitles` map (an empty inline ASS
// track) to cover players that render from there instead.
//
// The response is rewritten on the fly with Firefox's filterResponseData.
// ---------------------------------------------------------------------------

const NONE_KEY = 'None'; // used as both the locale key and the menu label

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

const isObj = (v) => v !== null && typeof v === 'object';

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

function addNoneSubtitle(json) {
  if (!isObj(json)) return;
  let changed = false;

  // The entry that actually creates the menu row: point it at the clean,
  // subtitle-free manifest so selecting "None" plays the video with no subs.
  if (isObj(json.hardSubs) && !(NONE_KEY in json.hardSubs) && typeof json.url === 'string') {
    json.hardSubs = {
      [NONE_KEY]: { hlang: NONE_KEY, url: json.url, quality: 'adaptive' },
      ...json.hardSubs,
    };
    changed = true;
  }

  // Fallback for players that render soft subtitles from `subtitles`.
  if (isObj(json.subtitles) && !(NONE_KEY in json.subtitles)) {
    json.subtitles = {
      [NONE_KEY]: { format: 'ass', language: NONE_KEY, url: EMPTY_ASS_URL },
      ...json.subtitles,
    };
    changed = true;
  }

  return changed ? json : undefined;
}

browser.webRequest.onBeforeRequest.addListener(
  (d) => filterJson(d, addNoneSubtitle),
  { urls: ['*://www.crunchyroll.com/playback/v3/*/play*'] },
  ['blocking']
);
