(() => {
  const yt = window.YTPlus;
  if (!yt) return;

  const FREQUENCIES = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  const LABELS = ["32", "64", "125", "250", "500", "1K", "2K", "4K", "8K", "16K"];
  const PRESETS = {
    flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    bass: [10, 9, 7, 4, 1, 0, 0, 1, 2, 3],
    vocal: [-3, -2, 0, 3, 5, 6, 4, 2, 0, -2],
    rock: [5, 4, 2, -1, -2, 1, 3, 5, 6, 5],
    pop: [-1, 1, 3, 4, 3, 0, -1, 1, 3, 4],
    classical: [4, 3, 2, 1, 0, 0, 1, 2, 3, 4],
    night: [7, 6, 3, 1, 0, 1, 2, 3, 4, 5],
    podcast: [-5, -3, 1, 5, 7, 6, 4, 2, 0, -3]
  };

  const boundVideos = new WeakSet();
  let context = null;
  let graph = null;
  let analyser = null;
  let analyserBuffer = null;
  let streamDestination = null;

  function ensureContext() {
    if (!context) context = new (window.AudioContext || window.webkitAudioContext)();
    if (context.state === "suspended") context.resume().catch(() => {});
    return context;
  }

  function applyGains() {
    if (!graph) return;
    const eqOn = yt.settings.eqEnabled;
    graph.bands.forEach((filter, index) => {
      filter.gain.value = eqOn ? (yt.settings.eqBands[index] || 0) : 0;
    });
    graph.preamp.gain.value = Math.pow(10, (yt.settings.eqPreamp || 0) / 20);
    graph.boost.gain.value = (yt.settings.boost || 100) / 100;
    graph.compressor.ratio.value = yt.settings.compressor ? 8 : 3.5;
    graph.compressor.threshold.value = yt.settings.compressor ? -28 : -18;
  }

  function build() {
    const video = window.YTPlusPlayer.video;
    if (!video || !yt.settings.enabled || !yt.settings.audio) return;
    if (boundVideos.has(video)) return;

    let source;
    try {
      source = ensureContext().createMediaElementSource(video);
    } catch {
      return;
    }
    boundVideos.add(video);

    const preamp = context.createGain();
    const bands = FREQUENCIES.map((frequency, index) => {
      const filter = context.createBiquadFilter();
      filter.type = index === 0 ? "lowshelf" : index === FREQUENCIES.length - 1 ? "highshelf" : "peaking";
      filter.frequency.value = frequency;
      filter.Q.value = 1.05;
      filter.gain.value = 0;
      return filter;
    });
    const compressor = context.createDynamicsCompressor();
    compressor.knee.value = 12;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.22;
    const boost = context.createGain();
    const master = context.createGain();
    master.gain.value = 0.92;

    analyser = context.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.6;
    analyserBuffer = new Uint8Array(analyser.fftSize);

    streamDestination = context.createMediaStreamDestination();

    source.connect(preamp);
    let previous = preamp;
    for (const filter of bands) {
      previous.connect(filter);
      previous = filter;
    }
    previous.connect(compressor);
    compressor.connect(boost);
    boost.connect(master);
    master.connect(analyser);
    master.connect(streamDestination);
    master.connect(context.destination);

    graph = { source, preamp, bands, compressor, boost, master };
    applyGains();
    yt.emit("audio:ready");
  }

  function destroy() {
    if (!graph) return;
    try {
      graph.source.disconnect();
      graph.preamp.disconnect();
      graph.bands.forEach((filter) => filter.disconnect());
      graph.compressor.disconnect();
      graph.boost.disconnect();
      graph.master.disconnect();
    } catch {}
    graph = null;
  }

  window.YTPlusAudio = {
    frequencies: FREQUENCIES,
    labels: LABELS,
    presets: PRESETS,
    get ready() {
      return !!analyser;
    },
    get stream() {
      return streamDestination?.stream || null;
    },

    rms() {
      if (!analyser) return -1;
      analyser.getByteTimeDomainData(analyserBuffer);
      let sum = 0;
      for (let index = 0; index < analyserBuffer.length; index++) {
        const value = (analyserBuffer[index] - 128) / 128;
        sum += value * value;
      }
      return Math.sqrt(sum / analyserBuffer.length);
    },

    setBand(index, gain) {
      const bands = [...yt.settings.eqBands];
      bands[index] = gain;
      yt.set("eqBands", bands);
      if (graph) graph.bands[index].gain.value = yt.settings.eqEnabled ? gain : 0;
      yt.emit("eq:bands", bands);
    },

    applyPreset(name) {
      const gains = PRESETS[name] || PRESETS.flat;
      yt.set("eqPreset", name);
      yt.set("eqBands", [...gains]);
      applyGains();
      yt.emit("eq:bands", gains);
    },

    setPreamp(value) {
      yt.set("eqPreamp", value);
      applyGains();
    },

    setBoost(value) {
      yt.set("boost", value);
      applyGains();
    },

    setCompressor(enabled) {
      yt.set("compressor", enabled);
      applyGains();
    },

    toggleEq(enabled) {
      yt.set("eqEnabled", enabled);
      applyGains();
      yt.emit("eq:bands", yt.settings.eqBands);
    },

    sync: applyGains
  };

  yt.on("ready", () => setTimeout(build, 1200));
  yt.on("video:new", () => setTimeout(build, 300));
  yt.onNavigate(() => setTimeout(build, 1400));
  yt.on("settings", (event) => {
    if ("audio" in event.detail) {
      event.detail.audio.newValue ? build() : destroy();
    }
    applyGains();
  });
  document.addEventListener("click", () => ensureContext(), { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) context?.resume?.().catch(() => {});
  });
})();