(() => {
  const yt = window.YTPlus;
  if (!yt) return;

  const LABELS = {
    sponsor: "Sponsor",
    selfpromo: "Self promo",
    interaction: "Interaction",
    intro: "Intro",
    outro: "Outro",
    preview: "Preview",
    music_offtopic: "Off-topic music"
  };

  let segments = [];
  let activeVideoId = null;
  let handled = new Set();
  let lastSkip = null;

  async function load(videoId) {
    if (!videoId || videoId === activeVideoId) return;
    activeVideoId = videoId;
    segments = [];
    handled.clear();
    if (!yt.settings.enabled || !yt.settings.sponsorblock) return;
    const response = await chrome.runtime.sendMessage({
      type: "sponsor:segments",
      videoId,
      categories: yt.settings.sponsorCategories
    });
    if (response?.ok && Array.isArray(response.data)) segments = response.data;
  }

  function tick() {
    if (!yt.settings.enabled || !yt.settings.sponsorblock || yt.isAd()) return;
    const video = window.YTPlusPlayer.video;
    if (!video) return;
    const time = video.currentTime;
    for (const segment of segments) {
      if (handled.has(segment.uuid)) continue;
      if (time >= segment.start - 0.2 && time < segment.end - 0.25) {
        handled.add(segment.uuid);
        lastSkip = { start: segment.start, category: segment.category, uuid: segment.uuid };
        video.currentTime = segment.end + 0.05;
        yt.toast("Skipped " + (LABELS[segment.category] || segment.category) + " · " + Math.round(segment.end - segment.start) + "s", "ok");
        yt.emit("sponsor:skipped", segment);
        break;
      }
    }
  }

  window.YTPlusSponsor = {
    get count() {
      return segments.length;
    },
    undo() {
      const video = window.YTPlusPlayer.video;
      if (!video || !lastSkip) return;
      handled.delete(lastSkip.uuid);
      video.currentTime = lastSkip.start + 0.1;
      yt.toast("Skip undone");
    }
  };

  yt.on("ready", () => {
    load(yt.videoId());
    setInterval(tick, 280);
  });
  yt.onNavigate(() => {
    segments = [];
    activeVideoId = null;
    setTimeout(() => load(yt.videoId()), 800);
  });
  yt.on("settings", (event) => {
    if ("sponsorblock" in event.detail) {
      segments = [];
      activeVideoId = null;
      load(yt.videoId());
    }
  });
})();