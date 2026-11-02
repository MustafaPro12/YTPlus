(() => {
  const yt = window.YTPlus;
  if (!yt) return;

  const cache = new Map();

  function decodeEntities(text) {
    const area = document.createElement("textarea");
    area.innerHTML = text;
    return area.value;
  }

  async function collectTranscript() {
    const response = window.ytInitialPlayerResponse;
    const tracks = response?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    if (!tracks.length) throw new Error("No captions available for this video.");

    const track =
      tracks.find((item) => item.languageCode === "tr") ||
      tracks.find((item) => item.languageCode === "en") ||
      tracks[0];

    const fetchResult = await fetch(track.baseUrl + "&fmt=json3");
    const payload = await fetchResult.json();
    const lines = [];
    for (const event of payload.events || []) {
      const text = (event.segs || []).map((segment) => segment.utf8).join("").trim();
      if (!text || text === "\n") continue;
      const seconds = Math.floor((event.tStartMs || 0) / 1000);
      lines.push(
        "[" + String(Math.floor(seconds / 60)).padStart(2, "0") + ":" +
        String(seconds % 60).padStart(2, "0") + "] " + decodeEntities(text)
      );
    }
    if (!lines.length) throw new Error("Transcript is empty.");
    return { text: lines.join("\n"), language: track.languageCode };
  }

  window.YTPlusSummary = {
    async run() {
      const videoId = yt.videoId();
      if (!videoId) throw new Error("No video loaded.");
      if (!yt.settings.geminiKey) throw new Error("Add a Gemini API key in settings.");
      if (cache.has(videoId)) return cache.get(videoId);

      const transcript = await collectTranscript();
      const response = await chrome.runtime.sendMessage({
        type: "gemini:summarize",
        transcript: transcript.text,
        title: yt.title(),
        apiKey: yt.settings.geminiKey,
        model: yt.settings.geminiModel,
        language: transcript.language
      });
      if (!response?.ok) throw new Error(response?.error || "Summary failed.");
      cache.set(videoId, response.data);
      return response.data;
    },
    clear() {
      cache.clear();
    }
  };
})();