(() => {
  const yt = window.YTPlus;
  if (!yt) return;

  let fastWatchdog = null;
  let slowWatchdog = null;
  let verifyTimer = null;
  let lockedTarget = null;
  let lastAppliedAt = 0;

  function scoreCandidate(candidate) {
    const height =
      parseInt(candidate.qualityLabel, 10) ||
      window.YTPlusPlayer.heightByName[candidate.quality] ||
      0;
    const fps = window.YTPlusPlayer.parseFps(candidate.qualityLabel);
    const codec = window.YTPlusPlayer.codecRank(candidate.quality);
    return height * 1000 + fps * 10 + codec;
  }

  function chooseTarget() {
    const data = window.YTPlusPlayer.qualityData();
    const playable = data.filter((item) => item.quality && item.isPlayable !== false);
    if (playable.length) {
      playable.sort((a, b) => scoreCandidate(b) - scoreCandidate(a));
      return playable[0].quality;
    }
    const levels = yt.player()?.getAvailableQualityLevels?.() || [];
    for (const name of window.YTPlusPlayer.qualityOrder) {
      if (levels.includes(name)) return name;
    }
    return null;
  }

  function verify(expected) {
    const current = window.YTPlusPlayer.currentQuality();
    if (current === expected) {
      yt.emit("quality:locked", expected);
      return true;
    }
    return false;
  }

  function apply(force) {
    if (!yt.settings.enabled || !yt.settings.qualityLock) return;
    if (yt.isAd() || !yt.videoId()) return;
    if (!force && performance.now() - lastAppliedAt < 900) return;

    const target = chooseTarget();
    if (!target) return;
    if (target === window.YTPlusPlayer.currentQuality() && !force) return;

    lockedTarget = target;
    lastAppliedAt = performance.now();
    window.YTPlusPlayer.applyQuality(target);

    clearTimeout(verifyTimer);
    verifyTimer = setTimeout(() => {
      if (verify(target)) return;
      window.YTPlusPlayer.applyQuality(target);
      setTimeout(() => {
        if (!verify(target)) {
          const player = yt.player();
          try {
            player?.setPlaybackQualityRange?.(target, target);
          } catch {}
        }
      }, 600);
    }, 1200);
  }

  function publishStats() {
    const stats = window.YTPlusPlayer.stats();
    const capacity = window.YTPlusPlayer.sourceCapacity();
    if (!stats && !capacity.height) return;
    yt.emit("quality:stats", {
      quality: window.YTPlusPlayer.currentQuality() || "",
      label: stats?.qualityLabel || "",
      dimensions: stats?.dimensions || "",
      fps: stats?.fps || "",
      bitrate: stats?.bitrate || "",
      codecs: stats?.codecs || "",
      sourceHeight: capacity.height,
      sourceFps: capacity.fps
    });
  }

  function hookPlayer() {
    const player = yt.player();
    if (player && !player.__ytplusQualityHooked) {
      player.__ytplusQualityHooked = true;
      try {
        player.addEventListener("onPlaybackQualityChange", () => {
          if (lockedTarget && window.YTPlusPlayer.currentQuality() !== lockedTarget) {
            setTimeout(() => apply(true), 250);
          }
          publishStats();
        });
        player.addEventListener("onStateChange", (state) => {
          if (state === 1) apply(true);
        });
      } catch {}
    }
    const video = window.YTPlusPlayer.video;
    if (video && !video.__ytplusQualityHooked) {
      video.__ytplusQualityHooked = true;
      ["loadedmetadata", "canplay", "playing", "seeked", "resume"].forEach((event) =>
        video.addEventListener(event, () => apply(true))
      );
    }
  }

  function start() {
    stop();
    hookPlayer();
    apply(true);
    fastWatchdog = setInterval(() => {
      hookPlayer();
      apply(false);
      publishStats();
    }, 700);
    slowWatchdog = setInterval(() => apply(true), 5000);
  }

  function stop() {
    if (fastWatchdog) clearInterval(fastWatchdog);
    if (slowWatchdog) clearInterval(slowWatchdog);
    fastWatchdog = null;
    slowWatchdog = null;
    lockedTarget = null;
  }

  yt.on("ready", start);
  yt.on("ad:end", () => setTimeout(() => apply(true), 400));
  yt.on("video:new", () => {
    hookPlayer();
    apply(true);
  });
  yt.onNavigate(() => setTimeout(() => {
    hookPlayer();
    apply(true);
  }, 1300));
  yt.on("settings", (event) => {
    if ("qualityLock" in event.detail) {
      event.detail.qualityLock.newValue ? start() : stop();
    }
  });
})();