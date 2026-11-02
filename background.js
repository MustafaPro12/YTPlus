const SPONSOR_API = "https://sponsor.ajay.app/api/skipSegments";
const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta/models";
const TENOR_API = "https://g.tenor.com/v1";
const TENOR_KEY = "LIVDSRZULELA";

const segmentCache = new Map();
const thumbCache = new Map();
const MAX_CACHE = 600;

function trimCache(map) {
  if (map.size <= MAX_CACHE) return;
  const oldest = map.keys().next().value;
  map.delete(oldest);
}

async function fetchSegments(videoId, categories) {
  const key = videoId + "|" + categories.join(",");
  if (segmentCache.has(key)) return segmentCache.get(key);
  try {
    const response = await fetch(
      SPONSOR_API +
        "?videoID=" + encodeURIComponent(videoId) +
        "&categories=" + encodeURIComponent(JSON.stringify(categories))
    );
    if (response.status === 404) {
      segmentCache.set(key, []);
      return [];
    }
    if (!response.ok) throw new Error("sponsorblock " + response.status);
    const payload = await response.json();
    const segments = (payload || []).map((item) => ({
      start: item.segment[0],
      end: item.segment[1],
      category: item.category,
      uuid: item.UUID
    }));
    segmentCache.set(key, segments);
    trimCache(segmentCache);
    return segments;
  } catch {
    return [];
  }
}

async function runGemini({ transcript, title, apiKey, model, language }) {
  if (!apiKey) throw new Error("missing Gemini API key");
  const prompt =
    "You are analysing a YouTube video transcript.\n" +
    "Title: " + title + "\nTranscript language: " + (language || "unknown") + "\n\n" +
    "Produce, in the language of the transcript if it is Turkish or English, otherwise English:\n" +
    "1) A 3-5 bullet summary\n2) Key takeaways\n3) A timestamped chapter list\n4) One sentence verdict on whether it is worth watching\n\n" +
    "TRANSCRIPT:\n" + transcript.slice(0, 200000);

  const response = await fetch(
    GEMINI_API + "/" + encodeURIComponent(model || "gemini-2.0-flash") +
      ":generateContent?key=" + encodeURIComponent(apiKey),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.35, maxOutputTokens: 3072 }
      })
    }
  );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error("gemini " + response.status + ": " + text.slice(0, 240));
  }
  const payload = await response.json();
  const output = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text).join("") || "";
  if (!output) throw new Error("gemini returned an empty response");
  return output;
}

function normalizeGifUrl(raw) {
  if (!raw) return null;
  let url = String(raw).split("#")[0].split("?")[0].trim();
  if (url.startsWith("http://")) url = "https://" + url.slice(7);
  const short = url.match(/^https:\/\/i\.giphy\.com\/([\w]+)\.gif$/);
  if (short) url = "https://media.giphy.com/media/" + short[1] + "/giphy.gif";
  if (!/\.(gif|webp|mp4)$/i.test(url)) return null;
  return url;
}

function mapTenor(results, fallbackTitle) {
  return results
    .map((item) => {
      const media = item.media?.[0];
      const full = normalizeGifUrl(media?.gif?.url);
      const preview = normalizeGifUrl(media?.tinygif?.url) || full;
      return {
        id: item.id,
        preview,
        full,
        title: item.content_description || fallbackTitle
      };
    })
    .filter((item) => item.preview && item.full);
}

async function searchGifs({ query, giphyKey }) {
  try {
    const endpoint = query ? "search" : "trending";
    const url =
      TENOR_API + "/" + endpoint + "?key=" + TENOR_KEY +
      "&limit=24&media_filter=minimal&locale=tr_TR&contentfilter=high" +
      (query ? "&q=" + encodeURIComponent(query) : "");
    const response = await fetch(url);
    if (response.ok) {
      const payload = await response.json();
      const mapped = mapTenor(payload.results || [], query || "trending");
      if (mapped.length) return mapped;
    }
  } catch {}

  const key = giphyKey || "dc6zaTOxFJmzC";
  const giphyEndpoint = query ? "search" : "trending";
  const url =
    "https://api.giphy.com/v1/gifs/" + giphyEndpoint +
    "?api_key=" + encodeURIComponent(key) +
    "&limit=24&rating=pg-13" + (query ? "&q=" + encodeURIComponent(query) : "");
  const response = await fetch(url);
  if (!response.ok) throw new Error("GIF service returned " + response.status);
  const payload = await response.json();
  return (payload.data || [])
    .map((item) => ({
      id: item.id,
      preview:
        normalizeGifUrl(item.images.fixed_width_small?.url) ||
        normalizeGifUrl(item.images.fixed_width?.url),
      full:
        normalizeGifUrl(item.images.original?.url) ||
        normalizeGifUrl(item.images.fixed_width?.url),
      title: item.title
    }))
    .filter((item) => item.preview && item.full);
}

async function shortenGif({ url }) {
  try {
    const response = await fetch("https://is.gd/create.php?format=simple&url=" + encodeURIComponent(url));
    if (response.ok) {
      const text = (await response.text()).trim();
      if (/^https:\/\/is\.gd\/[\w-]+$/.test(text)) return text;
    }
  } catch {}
  try {
    const response = await fetch("https://tinyurl.com/api-create.php?url=" + encodeURIComponent(url));
    if (response.ok) {
      const text = (await response.text()).trim();
      if (/^https:\/\/tinyurl\.com\/[\w-]+$/.test(text)) return text;
    }
  } catch {}
  return url;
}

async function fetchGif({ url }) {
  const response = await fetch(url, { credentials: "omit" });
  if (!response.ok) throw new Error("gif " + response.status);
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunk));
  }
  return {
    base64: btoa(binary),
    mime: response.headers.get("content-type") || "image/gif"
  };
}

async function resolveGif({ url }) {
  try {
    const response = await fetch(url, { redirect: "follow", credentials: "omit" });
    return response.url || url;
  } catch {
    return url;
  }
}

function skinRatio(data, width, height, region) {
  const x0 = Math.floor(width * region.left);
  const x1 = Math.floor(width * region.right);
  const y0 = Math.floor(height * region.top);
  const y1 = Math.floor(height * region.bottom);
  let skin = 0;
  let total = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const offset = (y * width + x) * 4;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      total++;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (r > 92 && g > 38 && b > 18 && max - min > 14 && Math.abs(r - g) > 12 && r > g && r > b) skin++;
    }
  }
  return total ? skin / total : 0;
}

async function analyzeThumbnail({ url }) {
  if (!url) return 0;
  if (thumbCache.has(url)) return thumbCache.get(url);
  try {
    const response = await fetch(url, { credentials: "omit" });
    if (!response.ok) return 0;
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    const width = 72;
    const height = 40;
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0, width, height);
    const frame = context.getImageData(0, 0, width, height);
    const full = skinRatio(frame.data, width, height, { left: 0, right: 1, top: 0, bottom: 1 });
    const center = skinRatio(frame.data, width, height, { left: 0.2, right: 0.8, top: 0.15, bottom: 0.85 });
    const score = Math.round((full * 0.45 + center * 0.55) * 1000) / 1000;
    thumbCache.set(url, score);
    trimCache(thumbCache);
    bitmap.close?.();
    return score;
  } catch {
    return 0;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    try {
      if (message?.type === "sponsor:segments") {
        sendResponse({ ok: true, data: await fetchSegments(message.videoId, message.categories) });
      } else if (message?.type === "gemini:summarize") {
        sendResponse({ ok: true, data: await runGemini(message) });
      } else if (message?.type === "gif:search") {
        sendResponse({ ok: true, data: await searchGifs(message) });
      } else if (message?.type === "gif:shorten") {
        sendResponse({ ok: true, data: await shortenGif(message) });
      } else if (message?.type === "gif:fetch") {
        sendResponse({ ok: true, data: await fetchGif(message) });
      } else if (message?.type === "gif:resolve") {
        sendResponse({ ok: true, data: await resolveGif(message) });
      } else if (message?.type === "nsfw:thumbnail") {
        sendResponse({ ok: true, data: await analyzeThumbnail(message) });
      } else {
        sendResponse({ ok: false, error: "unknown request" });
      }
    } catch (error) {
      sendResponse({ ok: false, error: String(error.message || error) });
    }
  })();
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  segmentCache.clear();
  thumbCache.clear();
});