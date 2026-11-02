(() => {
  const yt = window.YTPlus;
  if (!yt) return;

  let loopStart = null;
  let loopEnd = null;
  let recorder = null;
  let recordedChunks = [];
  let sleepTimer = null;
  let sleepDeadline = 0;

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function safeName(suffix) {
    const stamp = Math.floor((window.YTPlusPlayer.video?.currentTime || 0));
    return yt.title().replace(/[^\w\s-]/g, "").slice(0, 60) + "_" + stamp + "s" + suffix;
  }

  function screenshot() {
    const video = window.YTPlusPlayer.video;
    if (!video || !video.videoWidth) {
      yt.toast("Frame not ready", "warn");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      download(blob, safeName(".png"));
      yt.toast("Frame saved", "ok");
    }, "image/png");
  }

  function startClip(seconds) {
    const video = window.YTPlusPlayer.video;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const context = canvas.getContext("2d");
    const stream = canvas.captureStream(30);

    const audioStream = window.YTPlusAudio?.stream;
    if (audioStream) audioStream.getAudioTracks().forEach((track) => stream.addTrack(track));

    let drawing = true;
    const paint = () => {
      if (!drawing) return;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      requestAnimationFrame(paint);
    };
    paint();

    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : "video/webm";

    recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8000000 });
    recordedChunks = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size) recordedChunks.push(event.data);
    };
    recorder.onstop = () => {
      drawing = false;
      const blob = new Blob(recordedChunks, { type: "video/webm" });
      download(blob, safeName(".webm"));
      yt.toast("Clip saved", "ok");
      recorder = null;
    };
    recorder.start();
    yt.toast("Recording " + seconds + "s…", "ok");
    setTimeout(() => recorder?.state === "recording" && recorder.stop(), seconds * 1000);
  }

  function markLoop(point) {
    const video = window.YTPlusPlayer.video;
    if (!video) return;
    if (point === "a") {
      loopStart = video.currentTime;
      yt.toast("A: " + loopStart.toFixed(1) + "s", "ok");
    } else if (loopStart !== null) {
      loopEnd = video.currentTime;
      yt.toast("Loop " + loopStart.toFixed(1) + "–" + loopEnd.toFixed(1) + "s", "ok");
    }
  }

  function clearLoop() {
    loopStart = null;
    loopEnd = null;
    yt.toast("Loop cleared");
  }

  function loopTick() {
    const video = window.YTPlusPlayer.video;
    if (!video || loopStart === null || loopEnd === null) return;
    if (video.currentTime > loopEnd || video.currentTime < loopStart - 1) video.currentTime = loopStart;
  }

  function setSleep(minutes) {
    clearInterval(sleepTimer);
    if (!minutes) {
      yt.toast("Sleep timer off");
      return;
    }
    sleepDeadline = Date.now() + minutes * 60000;
    sleepTimer = setInterval(() => {
      if (Date.now() < sleepDeadline) return;
      clearInterval(sleepTimer);
      window.YTPlusPlayer.video?.pause();
      yt.toast("Sleep timer finished", "ok");
    }, 1000);
    yt.toast("Sleep in " + minutes + " min", "ok");
  }

  function applyCleanUi() {
    const root = document.documentElement;
    root.classList.toggle("ytplus-clean", yt.settings.enabled && yt.settings.cleanUi);
    root.classList.toggle("ytplus-hide-endcards", yt.settings.enabled && yt.settings.hideEndCards);
    root.classList.toggle("ytplus-hide-cards", yt.settings.enabled && yt.settings.hideInfoCards);
    root.classList.toggle("ytplus-hide-chat", yt.settings.enabled && yt.settings.hideChat);
    root.classList.toggle("ytplus-hide-shorts", yt.settings.enabled && yt.settings.hideShortsShelf);
    root.classList.toggle("ytplus-dim", yt.settings.enabled && yt.settings.dimPage);
  }

  const SHORTCUTS = [
    ["Shift", ".", "speed up"],
    ["Shift", ",", "slow down"],
    ["Shift", "0", "reset speed"],
    ["Shift", "A", "toggle smart speed"],
    ["Shift", "B", "toggle NSFW blur"],
    ["Shift", "M", "toggle music blur"],
    ["Shift", "E", "toggle equalizer"],
    ["Shift", "S", "screenshot"],
    ["Shift", "C", "record clip"],
    ["Shift", "G", "open GIF picker"],
    ["Shift", "F", "focus mode"],
    ["Shift", "1", "set loop A"],
    ["Shift", "2", "set loop B"],
    ["Shift", "X", "clear loop"]
  ];

  function showShortcuts() {
    if (document.getElementById("ytplus-help")) {
      document.getElementById("ytplus-help").remove();
      return;
    }
    const panel = document.createElement("div");
    panel.id = "ytplus-help";
    panel.innerHTML =
      '<div class="ytplus-help-card"><h3>Keyboard shortcuts</h3>' +
      SHORTCUTS.map(([mod, key, label]) => '<div class="ytplus-help-row"><kbd>' + mod + " " + key + "</kbd><span>" + label + "</span></div>").join("") +
      '<button type="button" class="ytplus-btn">Close</button></div>';
    panel.querySelector("button").addEventListener("click", () => panel.remove());
    document.documentElement.appendChild(panel);
  }

  document.addEventListener("keydown", (event) => {
    if (!yt.settings.enabled || !yt.settings.tools) return;
    if (!event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
    const active = document.activeElement;
    if (active?.tagName === "INPUT" || active?.tagName === "TEXTAREA" || active?.isContentEditable) return;

    const video = window.YTPlusPlayer.video;
    switch (event.key) {
      case ".":
        if (video) window.YTPlusPlayer.setRate(video.playbackRate + 0.1);
        event.preventDefault();
        break;
      case ",":
        if (video) window.YTPlusPlayer.setRate(video.playbackRate - 0.1);
        event.preventDefault();
        break;
      case "0":
        window.YTPlusPlayer.setRate(1);
        event.preventDefault();
        break;
      case "A":
        yt.set("autoSpeed", !yt.settings.autoSpeed);
        event.preventDefault();
        break;
      case "B":
        yt.set("nsfwVideo", !yt.settings.nsfwVideo);
        event.preventDefault();
        break;
      case "M":
        yt.set("musicBlur", !yt.settings.musicBlur);
        event.preventDefault();
        break;
      case "E":
        yt.set("eqEnabled", !yt.settings.eqEnabled);
        event.preventDefault();
        break;
      case "S":
        screenshot();
        event.preventDefault();
        break;
      case "C":
        startClip(5);
        event.preventDefault();
        break;
      case "G":
        window.YTPlusGif?.open();
        event.preventDefault();
        break;
      case "F":
        yt.set("focusMode", !yt.settings.focusMode);
        document.documentElement.classList.toggle("ytplus-focus", yt.settings.focusMode);
        event.preventDefault();
        break;
      case "1":
        markLoop("a");
        event.preventDefault();
        break;
      case "2":
        markLoop("b");
        event.preventDefault();
        break;
      case "X":
        clearLoop();
        event.preventDefault();
        break;
      case "?":
        showShortcuts();
        event.preventDefault();
        break;
    }
  });

  yt.on("ready", () => {
    applyCleanUi();
    document.documentElement.classList.toggle("ytplus-focus", !!yt.settings.focusMode);
    setInterval(loopTick, 120);
  });
  yt.on("settings", applyCleanUi);

  window.YTPlusTools = {
    screenshot,
    startClip,
    markLoop,
    clearLoop,
    setSleep,
    showShortcuts,
    get loop() {
      return { start: loopStart, end: loopEnd };
    }
  };
})();