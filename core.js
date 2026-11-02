(() => {
  if (window.__YTPlus) return;
  window.__YTPlus = true;

  const DEFAULTS = {
    enabled: true,
    ads: true,
    qualityLock: true,
    autoSpeed: true,
    autoSpeedMode: "balanced",
    autoSpeedMin: 0.85,
    autoSpeedMax: 2.0,
    autoSpeedBase: 1.15,
    sponsorblock: true,
    sponsorCategories: ["sponsor", "selfpromo", "interaction", "intro", "outro", "preview", "music_offtopic"],
    nsfwThumbs: true,
    nsfwVideo: true,
    nsfwThreshold: 0.3,
    musicBlur: true,
    musicBlurAmount: 22,
    audio: true,
    eqEnabled: true,
    eqPreset: "flat",
    eqPreamp: 0,
    eqBands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    boost: 100,
    compressor: false,
    cleanUi: true,
    hideEndCards: true,
    hideInfoCards: true,
    hideChat: false,
    hideShortsShelf: true,
    dimPage: false,
    geminiKey: "",
    geminiModel: "gemini-2.0-flash",
    giphyKey: "",
    tools: true,
    panelOpen: true,
    debug: false
  };

  const bus = new EventTarget();
  const state = { settings: { ...DEFAULTS }, flags: {} };
  const pendingWrites = new Set();
  const navigationHandlers = new Set();
  const toastQueue = [];
  let writeTimer = null;
  let toastActive = false;
  let lastHref = location.href;

  function flushWrites() {
    if (!pendingWrites.size) return;
    const patch = {};
    for (const key of pendingWrites) patch[key] = state.settings[key];
    pendingWrites.clear();
    chrome.storage.local.set(patch).catch(() => {});
  }

  function scheduleWrite(key) {
    pendingWrites.add(key);
    clearTimeout(writeTimer);
    writeTimer = setTimeout(flushWrites, 280);
  }

  function drainToasts() {
    const next = toastQueue.shift();
    if (!next) {
      toastActive = false;
      return;
    }
    toastActive = true;
    let element = document.getElementById("ytplus-toast");
    if (!element) {
      element = document.createElement("div");
      element.id = "ytplus-toast";
      document.documentElement.appendChild(element);
    }
    element.textContent = next.text;
    element.dataset.kind = next.kind;
    element.classList.add("show");
    setTimeout(() => {
      element.classList.remove("show");
      setTimeout(drainToasts, 180);
    }, next.duration);
  }

  function emitNavigation() {
    if (location.href === lastHref) return;
    lastHref = location.href;
    for (const handler of navigationHandlers) {
      try {
        handler(location.href);
      } catch (error) {
        console.error(error);
      }
    }
  }

  const api = {
    version: "3.0.0",
    bus,
    state,
    get settings() {
      return state.settings;
    },

    async init() {
      const stored = await chrome.storage.local.get(DEFAULTS);
      state.settings = { ...DEFAULTS, ...stored };
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local") return;
        for (const key of Object.keys(changes)) state.settings[key] = changes[key].newValue;
        bus.dispatchEvent(new CustomEvent("settings", { detail: changes }));
      });
      bus.dispatchEvent(new CustomEvent("ready"));
    },

    set(key, value, immediate) {
      state.settings[key] = value;
      if (immediate) {
        pendingWrites.add(key);
        flushWrites();
      } else {
        scheduleWrite(key);
      }
      bus.dispatchEvent(new CustomEvent("settings", { detail: { [key]: { newValue: value } } }));
    },

    flag(key, value) {
      state.flags[key] = value;
      bus.dispatchEvent(new CustomEvent("flag", { detail: { key, value } }));
    },

    getFlag(key, fallback) {
      const value = state.flags[key];
      return value === undefined ? (fallback === undefined ? false : fallback) : value;
    },

    on(event, handler) {
      bus.addEventListener(event, handler);
      return () => bus.removeEventListener(event, handler);
    },

    emit(event, detail) {
      bus.dispatchEvent(new CustomEvent(event, { detail }));
    },

    onNavigate(handler) {
      navigationHandlers.add(handler);
      return () => navigationHandlers.delete(handler);
    },

    video() {
      return (
        document.querySelector("video.html5-main-video") ||
        document.querySelector("#movie_player video") ||
        null
      );
    },

    player() {
      return document.getElementById("movie_player");
    },

    isAd() {
      return !!this.player()?.classList.contains("ad-showing");
    },

    isWatch() {
      return location.pathname === "/watch";
    },

    videoId() {
      const url = new URL(location.href);
      if (url.pathname === "/watch") return url.searchParams.get("v");
      const match = url.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{5,})/);
      return match ? match[1] : null;
    },

    channelId() {
      const link = document.querySelector("ytd-watch-metadata #owner a, #owner ytd-channel-name a");
      return link ? (link.getAttribute("href") || "").replace(/^\//, "") : null;
    },

    isMusic() {
      const genre = document.querySelector('meta[itemprop="genre"]')?.content;
      if (genre === "Music") return true;
      const category = document.querySelector("ytd-watch-metadata a[href*='search_query']")?.textContent || "";
      return /^(music|müzik)$/i.test(category.trim());
    },

    title() {
      return (document.title || "video").replace(/ - YouTube$/, "");
    },

    toast(text, kind, duration) {
      toastQueue.push({ text, kind: kind || "info", duration: duration || 2200 });
      if (!toastActive) drainToasts();
    },

    log(...args) {
      if (state.settings.debug) console.log("[YTPlus]", ...args);
    }
  };

  ["yt-navigate-finish", "yt-page-data-updated"].forEach((event) =>
    document.addEventListener(event, () => {
      lastHref = "";
      emitNavigation();
    })
  );
  window.addEventListener("popstate", () => {
    lastHref = "";
    emitNavigation();
  });
  setInterval(emitNavigation, 700);

  window.YTPlus = api;
  api.init();
})();