(() => {
  const yt = window.YTPlus;
  if (!yt) return;

  const frameHandlers = new Set();
  let videoElement = null;
  let loopHandle = 0;
  let useVideoCallback = false;
  let internalRate = 0;
  let internalRateAt = 0;
  let scanTimer = null;

  function handleRateChange() {
    if (!videoElement) return;
    const difference = Math.abs(videoElement.playbackRate - internalRate);
    const recent = performance.now() - internalRateAt < 450;
    if (difference < 0.02 && recent) return;
    yt.emit("rate:user", videoElement.playbackRate);
  }

  function frameCallback(timestamp, metadata) {
    for (const handler of frameHandlers) {
      try {
        handler(timestamp, metadata);
      } catch (error) {
        console.error(error);
      }
    }
    scheduleFrame();
  }

  function scheduleFrame() {
    if (!videoElement) return;
    if (useVideoCallback && videoElement.requestVideoFrameCallback) {
      loopHandle = videoElement.requestVideoFrameCallback(frameCallback);
    } else {
      loopHandle = requestAnimationFrame((timestamp) => frameCallback(timestamp, null));
    }
  }

  function startLoop() {
    if (loopHandle) return;
    useVideoCallback = typeof HTMLVideoElement.prototype.requestVideoFrameCallback === "function";
    scheduleFrame();
  }

  function stopLoop() {
    if (!loopHandle) return;
    if (useVideoCallback && videoElement?.cancelVideoFrameCallback) {
      videoElement.cancelVideoFrameCallback(loopHandle);
    } else {
      cancelAnimationFrame(loopHandle);
    }
    loopHandle = 0;
  }

  function attach(element) {
    if (!element || element === videoElement) return;
    detach();
    videoElement = element;
    element.addEventListener("ratechange", handleRateChange);
    element.addEventListener("emptied", () => yt.emit("video:reset", element));
    yt.emit("video:new", element);
    startLoop();
  }

  function detach() {
    if (!videoElement) return;
    stopLoop();
    videoElement.removeEventListener("ratechange", handleRateChange);
    yt.emit("video:gone", videoElement);
    videoElement = null;
  }

  function scan() {
    const element = yt.video();
    if (element) {
      attach(element);
      if (scanTimer) {
        clearInterval(scanTimer);
        scanTimer = null;
      }
    }
  }

  const QUALITY_ORDER = ["highres", "hd2880", "hd2160", "hd1440", "hd1080", "hd720", "large", "medium", "small", "tiny"];
  const HEIGHT_BY_NAME = {
    highres: 4320, hd2880: 2880, hd2160: 2160, hd1440: 1440, hd1080: 1080,
    hd720: 720, large: 480, medium: 360, small: 240, tiny: 144
  };
  const CODEC_RANK = { av01: 3, vp9: 2, vp09: 2, avc1: 1 };

  function parseFps(label) {
    const match = String(label || "").match(/(\d+)fps/);
    return match ? parseInt(match[1], 10) : 0;
  }

  window.YTPlusPlayer = {
    get video() {
      return videoElement;
    },
    get player() {
      return yt.player();
    },
    qualityOrder: QUALITY_ORDER,
    heightByName: HEIGHT_BY_NAME,
    parseFps,

    onFrame(handler) {
      frameHandlers.add(handler);
      return () => frameHandlers.delete(handler);
    },

    setRate(rate) {
      if (!videoElement) return false;
      const clamped = Math.round(Math.min(4, Math.max(0.1, rate)) * 100) / 100;
      if (Math.abs(videoElement.playbackRate - clamped) < 0.005) return true;
      internalRate = clamped;
      internalRateAt = performance.now();
      try {
        videoElement.playbackRate = clamped;
        return true;
      } catch {
        return false;
      }
    },

    stats() {
      try {
        return yt.player()?.getStatsForNerds?.() || null;
      } catch {
        return null;
      }
    },

    qualityData() {
      const player = yt.player();
      try {
        if (typeof player?.getAvailableQualityData === "function") {
          return player.getAvailableQualityData() || [];
        }
        const levels = player?.getAvailableQualityLevels?.() || [];
        return levels.filter(Boolean).map((name) => ({
          quality: name,
          qualityLabel: String(HEIGHT_BY_NAME[name] || 0) + "p",
          isPlayable: true
        }));
      } catch {
        return [];
      }
    },

    sourceCapacity() {
      try {
        const response = yt.player()?.getPlayerResponse?.();
        const formats = response?.streamingData?.adaptiveFormats || [];
        let height = 0;
        let fps = 0;
        for (const format of formats) {
          if (format.height > height) height = format.height;
          if (format.fps > fps) fps = format.fps;
        }
        return { height, fps };
      } catch {
        return { height: 0, fps: 0 };
      }
    },

    applyQuality(name) {
      const player = yt.player();
      if (!player || !name) return false;
      try {
        player.setPlaybackQualityRange?.(name, name);
        player.setPlaybackQuality?.(name);
        return true;
      } catch {
        return false;
      }
    },

    currentQuality() {
      try {
        return yt.player()?.getPlaybackQuality?.() || null;
      } catch {
        return null;
      }
    },

    codecRank(name) {
      return CODEC_RANK[String(name || "").slice(0, 4)] || 0;
    }
  };

  yt.on("ready", () => {
    scan();
    if (!videoElement) scanTimer = setInterval(scan, 400);
  });
  yt.onNavigate(() => setTimeout(scan, 350));
})();