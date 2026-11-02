(() => {
  const yt = window.YTPlus;
  if (!yt) return;

  const THUMBNAIL_SELECTOR =
    "ytd-thumbnail img, ytd-playlist-thumbnail img, ytd-rich-item-renderer img.yt-core-image, " +
    "yt-lockup-view-model img, ytd-video-renderer img, ytd-compact-video-renderer img, " +
    "ytd-grid-video-renderer img";

  const SAMPLE_INTERVAL = 1200;
  const MAX_SAMPLES = 18;

  let observer = null;
  let sampleCanvas = null;
  let sampleContext = null;
  let videoScores = [];
  let videoRevealed = false;
  let musicRevealed = false;
  let sampleTimer = null;
  let overlay = null;
  let decision = "unknown";
  let mutationObserver = null;

  function ensureSampler() {
    if (sampleCanvas) return;
    sampleCanvas = document.createElement("canvas");
    sampleCanvas.width = 72;
    sampleCanvas.height = 40;
    sampleContext = sampleCanvas.getContext("2d", { willReadFrequently: true });
  }

  function skinRatio(data, width, height, left, right, top, bottom) {
    const x0 = Math.floor(width * left);
    const x1 = Math.floor(width * right);
    const y0 = Math.floor(height * top);
    const y1 = Math.floor(height * bottom);
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

  function sampleVideoFrame() {
    const video = window.YTPlusPlayer?.video;
    if (!video || !sampleContext || video.readyState < 2 || !video.videoWidth) return;
    if (yt.isAd()) return;
    try {
      sampleContext.drawImage(video, 0, 0, 72, 40);
      const frame = sampleContext.getImageData(0, 0, 72, 40);
      const full = skinRatio(frame.data, 72, 40, 0, 1, 0, 1);
      const center = skinRatio(frame.data, 72, 40, 0.2, 0.8, 0.15, 0.85);
      videoScores.push(full * 0.45 + center * 0.55);
      if (videoScores.length >= MAX_SAMPLES) stopSampling();
      decide();
    } catch {}
  }

  function startSampling() {
    ensureSampler();
    videoScores = [];
    decision = "unknown";
    if (sampleTimer) clearInterval(sampleTimer);
    sampleTimer = setInterval(sampleVideoFrame, SAMPLE_INTERVAL);
    setTimeout(stopSampling, MAX_SAMPLES * SAMPLE_INTERVAL + 500);
  }

  function stopSampling() {
    if (sampleTimer) clearInterval(sampleTimer);
    sampleTimer = null;
  }

  function averageScore() {
    if (!videoScores.length) return 0;
    const sorted = [...videoScores].sort((a, b) => a - b);
    const slice = sorted.slice(Math.floor(sorted.length * 0.25), Math.ceil(sorted.length * 0.85));
    const pool = slice.length ? slice : sorted;
    return pool.reduce((sum, value) => sum + value, 0) / pool.length;
  }

  function decide() {
    if (videoScores.length < 4) return;
    const score = averageScore();
    const threshold = yt.settings.nsfwThreshold || 0.3;
    decision = score >= threshold ? "nsfw" : "safe";
    yt.emit("nsfw:score", { score, decision, samples: videoScores.length });
    paint();
  }

  function musicActive() {
    return yt.settings.enabled && yt.settings.musicBlur && yt.isMusic() && !musicRevealed;
  }

  function nsfwActive() {
    if (!yt.settings.enabled || !yt.settings.nsfwVideo || !yt.isWatch()) return false;
    if (videoRevealed) return false;
    return decision === "nsfw";
  }

  function paint() {
    const video = window.YTPlusPlayer?.video;
    let blur = 0;
    if (nsfwActive()) blur = Math.max(blur, 16);
    if (musicActive()) blur = Math.max(blur, yt.settings.musicBlurAmount);
    if (video) video.style.setProperty("filter", blur ? "blur(" + blur + "px)" : "none", "important");

    document.documentElement.classList.toggle(
      "ytplus-nsfw",
      yt.settings.enabled && yt.settings.nsfwThumbs
    );

    const needsOverlay = yt.isWatch() && blur > 0;
    if (needsOverlay) showOverlay(musicActive() ? "Music mode" : "NSFW");
    else hideOverlay();
  }

  function showOverlay(label) {
    if (!overlay) {
      const host = yt.player() || document.querySelector("#player-container");
      if (!host) return;
      overlay = document.createElement("div");
      overlay.className = "ytplus-blur-overlay";
      overlay.innerHTML =
        '<div class="ytplus-blur-card"><span class="ytplus-blur-label"></span>' +
        '<button class="ytplus-reveal" type="button">Show</button></div>';
      overlay.querySelector("button").addEventListener("click", () => {
        if (musicActive()) musicRevealed = true;
        else videoRevealed = true;
        paint();
      });
      host.appendChild(overlay);
    }
    overlay.style.display = "flex";
    overlay.querySelector(".ytplus-blur-label").textContent = label;
  }

  function hideOverlay() {
    if (overlay) overlay.style.display = "none";
  }

  function analyzeThumbnail(image) {
    if (image.dataset.ytplusChecked) return;
    const source = image.currentSrc || image.src;
    if (!source || !source.includes("ytimg")) return;
    image.dataset.ytplusChecked = "1";
    chrome.runtime
      .sendMessage({ type: "nsfw:thumbnail", url: source })
      .then((response) => {
        if (!response?.ok) return;
        const threshold = yt.settings.nsfwThreshold || 0.3;
        if (response.data >= threshold) {
          image.classList.add("ytplus-nsfw-thumb");
          image.dataset.ytplusScore = String(response.data);
        }
      })
      .catch(() => {});
  }

  function startObserver() {
    if (observer) return;
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) analyzeThumbnail(entry.target);
        }
      },
      { rootMargin: "150px" }
    );
    document.querySelectorAll(THUMBNAIL_SELECTOR).forEach((image) => observer.observe(image));
  }

  function observeMutations() {
    if (mutationObserver) return;
    const target = document.body;
    if (!target) {
      document.addEventListener("DOMContentLoaded", observeMutations, { once: true });
      return;
    }
    mutationObserver = new MutationObserver(() => {
      if (!yt.settings.nsfwThumbs) return;
      document.querySelectorAll(THUMBNAIL_SELECTOR).forEach((image) => {
        if (!image.dataset.ytplusChecked) {
          observer?.observe(image);
          analyzeThumbnail(image);
        }
      });
    });
    mutationObserver.observe(target, { childList: true, subtree: true });
  }

  yt.on("ready", () => {
    startObserver();
    observeMutations();
    startSampling();
  });
  yt.on("video:new", startSampling);
  yt.on("settings", paint);
  yt.onNavigate(() => {
    videoRevealed = false;
    musicRevealed = false;
    decision = "unknown";
    videoScores = [];
    overlay?.remove();
    overlay = null;
    setTimeout(() => {
      startObserver();
      observeMutations();
      startSampling();
      paint();
    }, 900);
  });

  window.YTPlusNsfw = {
    get decision() {
      return decision;
    },
    get score() {
      return averageScore();
    },
    reset() {
      videoRevealed = false;
      musicRevealed = false;
      paint();
    },
    rescan: startSampling
  };
})();