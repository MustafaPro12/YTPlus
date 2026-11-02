(() => {
  const yt = window.YTPlus;
  if (!yt) return;

  const GRID_X = 24;
  const GRID_Y = 14;
  const MODES = {
    light: { lowMotion: 1.4, highMotion: 14, hold: 1000, step: 0.03, deadAir: 3000 },
    balanced: { lowMotion: 2.2, highMotion: 10, hold: 700, step: 0.04, deadAir: 2200 },
    aggressive: { lowMotion: 3.4, highMotion: 8, hold: 450, step: 0.06, deadAir: 1500 }
  };

  let canvas;
  let context;
  let previousFrame = null;
  let motionAverage = 0;
  let audioAverage = 0;
  let score = 0;
  let pendingScore = 0;
  let pendingSince = 0;
  let silentSince = 0;
  let currentRate = 1;
  let lastSampleAt = 0;
  let startedAt = 0;
  let userOverrideUntil = 0;
  let running = false;
  let unsubscribe = null;

  function mode() {
    return MODES[yt.settings.autoSpeedMode] || MODES.balanced;
  }

  function ensureCanvas() {
    if (canvas) return;
    canvas = document.createElement("canvas");
    canvas.width = GRID_X;
    canvas.height = GRID_Y;
    context = canvas.getContext("2d", { willReadFrequently: true });
  }

  function sampleMotion(video) {
    if (!context || video.readyState < 2 || !video.videoWidth) return null;
    try {
      context.drawImage(video, 0, 0, GRID_X, GRID_Y);
      const data = context.getImageData(0, 0, GRID_X, GRID_Y).data;
      const grays = new Float32Array(GRID_X * GRID_Y);
      for (let index = 0, pixel = 0; index < data.length; index += 4, pixel++) {
        grays[pixel] = data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
      }
      if (!previousFrame) {
        previousFrame = grays;
        return null;
      }
      let meanNow = 0;
      let meanPrevious = 0;
      for (let index = 0; index < grays.length; index++) {
        meanNow += grays[index];
        meanPrevious += previousFrame[index];
      }
      meanNow /= grays.length;
      meanPrevious /= grays.length;
      const differences = new Float32Array(grays.length);
      for (let index = 0; index < grays.length; index++) {
        differences[index] = Math.abs(
          grays[index] - meanNow - (previousFrame[index] - meanPrevious)
        );
      }
      previousFrame = grays;
      const sorted = Array.from(differences).sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length * 0.75)];
    } catch {
      return null;
    }
  }

  function evaluate(now) {
    const video = window.YTPlusPlayer.video;
    if (!video || !running) return;
    if (!yt.settings.enabled || !yt.settings.autoSpeed) return;
    if (yt.isAd() || video.paused || video.ended || video.seeking) return;
    if (now - lastSampleAt < 140) return;
    if (now - startedAt < 1800) return;
    if (now < userOverrideUntil) return;
    lastSampleAt = now;

    const settings = mode();
    const motion = sampleMotion(video);
    if (motion === null) return;
    motionAverage = motionAverage === 0 ? motion : motionAverage * 0.78 + motion * 0.22;

    const audio = window.YTPlusAudio?.rms?.() ?? -1;
    const hasAudio = audio >= 0;
    if (hasAudio) audioAverage = audioAverage === 0 ? audio : audioAverage * 0.75 + audio * 0.25;

    const silent = hasAudio && audioAverage < 0.012;
    const loud = hasAudio && audioAverage > 0.14;

    let next = 0;
    if (motionAverage < settings.lowMotion) next += 1;
    if (motionAverage > settings.highMotion) next -= 1;
    if (silent) next += 1;
    if (loud) next -= 1;

    if (silent && motionAverage < settings.lowMotion * 1.2) {
      if (!silentSince) silentSince = now;
      if (now - silentSince > settings.deadAir) next += 2;
    } else {
      silentSince = 0;
    }

    if (next !== pendingScore) {
      pendingScore = next;
      pendingSince = now;
    }
    if (now - pendingSince > settings.hold) score = next;

    const base = yt.settings.autoSpeedBase;
    const min = yt.settings.autoSpeedMin;
    const max = yt.settings.autoSpeedMax;

    let target = base;
    if (score >= 2) target = max;
    else if (score === 1) target = Math.min(max, base + 0.25);
    else if (score === -1) target = Math.max(min, base - 0.2);
    else if (score <= -2) target = min;

    const step = Math.sign(target - currentRate) * Math.min(settings.step, Math.abs(target - currentRate));
    currentRate += step;

    const rate = Math.min(max, Math.max(min, currentRate));
    if (window.YTPlusPlayer.setRate(rate)) {
      const reason =
        score >= 2 ? "dead air" :
        score === 1 ? "static" :
        score === 0 ? "normal" :
        score === -1 ? "busy" : "very busy";
      yt.emit("autospeed:state", { rate, reason, motion: motionAverage, audio: audioAverage });
    }
  }

  function start() {
    if (running) return;
    ensureCanvas();
    running = true;
    startedAt = performance.now();
    motionAverage = 0;
    audioAverage = 0;
    score = 0;
    pendingScore = 0;
    currentRate = 1;
    previousFrame = null;
    if (!unsubscribe) unsubscribe = window.YTPlusPlayer.onFrame(evaluate);
  }

  function stop() {
    running = false;
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    window.YTPlusPlayer?.setRate(1);
  }

  window.YTPlusSpeed = {
    start,
    stop,
    get running() {
      return running;
    }
  };

  yt.on("ready", () => {
    if (yt.settings.autoSpeed) start();
  });
  yt.on("settings", (event) => {
    if ("autoSpeed" in event.detail) {
      event.detail.autoSpeed.newValue ? start() : stop();
    }
  });
  yt.on("rate:user", () => {
    userOverrideUntil = performance.now() + 4000;
  });
  yt.onNavigate(() => {
    startedAt = performance.now();
    previousFrame = null;
  });
})();