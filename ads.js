(() => {
  const yt = window.YTPlus;
  if (!yt) return;

  const AD_CONTAINERS = [
    "#masthead-ad", "ytd-display-ad-renderer", "ytd-promoted-sparkles-web-renderer",
    "ytd-ad-slot-renderer", "ytd-in-feed-ad-layout-renderer", "#player-ads",
    ".ytp-ad-overlay-container", ".ytp-ad-overlay-slot", "ytd-banner-promo-renderer",
    "ytd-statement-banner-renderer", "ytd-companion-slot-renderer", "#offer-module",
    "ytd-engagement-panel-section-list-renderer[target-id='engagement-panel-ads']"
  ];
  const SKIP_BUTTONS = [
    ".ytp-ad-skip-button", ".ytp-ad-skip-button-modern", ".ytp-skip-ad-button",
    ".ytp-ad-skip-button-container button"
  ];

  let adActive = false;

  function hideContainers() {
    for (const selector of AD_CONTAINERS) {
      document.querySelectorAll(selector).forEach((node) => {
        if (node.style.display !== "none") node.style.display = "none";
      });
    }
  }

  function fastForwardAd() {
    const video = window.YTPlusPlayer.video;
    if (!video) return;
    try {
      video.playbackRate = 16;
    } catch {}
    const duration = video.duration;
    if (isFinite(duration) && duration > 0.7 && video.currentTime < duration - 0.7) {
      video.currentTime = Math.max(0, duration - 0.2);
    }
  }

  function clickSkip() {
    for (const selector of SKIP_BUTTONS) {
      const button = document.querySelector(selector);
      if (button && button.offsetParent !== null) {
        button.click();
        return;
      }
    }
  }

  function tick() {
    if (!yt.settings.enabled || !yt.settings.ads) return;
    hideContainers();

    const player = yt.player();
    const showing = !!player?.classList.contains("ad-showing");

    if (showing) {
      if (!adActive) {
        adActive = true;
        yt.flag("ad", true);
        yt.emit("ad:start");
      }
      fastForwardAd();
      clickSkip();
    } else if (adActive) {
      adActive = false;
      yt.flag("ad", false);
      yt.emit("ad:end");
    }
  }

  yt.on("ready", () => setInterval(tick, 200));
})();