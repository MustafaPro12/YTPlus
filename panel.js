(() => {
  const yt = window.YTPlus;
  if (!yt) return;

  let panel = null;
  let qualityBadge = null;
  let speedValue = null;
  let speedReason = null;
  let nsfwBadge = null;
  let summaryBox = null;

  function node(html) {
    const holder = document.createElement("div");
    holder.innerHTML = html.trim();
    return holder.firstElementChild;
  }

  function toggle(key, label) {
    const wrapper = node(
      '<label class="ytplus-switch"><input type="checkbox" data-key="' + key + '"><i></i><span>' + label + "</span></label>"
    );
    const input = wrapper.querySelector("input");
    input.checked = !!yt.settings[key];
    input.addEventListener("change", () => yt.set(key, input.checked));
    return wrapper;
  }

  function numberField(key, label, step, min, max) {
    const wrapper = node(
      '<span class="ytplus-badge">' + label + ' <input type="number" class="ytplus-number" data-key="' +
      key + '" step="' + step + '" min="' + min + '" max="' + max + '"></span>'
    );
    const input = wrapper.querySelector("input");
    input.value = yt.settings[key];
    input.addEventListener("change", () => yt.set(key, parseFloat(input.value) || min));
    return wrapper;
  }

  function build() {
    if (panel || !yt.settings.enabled || !yt.isWatch()) return;
    const anchor = document.querySelector("#below");
    if (!anchor) return;

    panel = node(
      '<div id="ytplus-panel">' +
        '<div class="ytplus-head">' +
          '<span class="ytplus-logo">YTPlus<span>+</span></span>' +
          '<div class="ytplus-head-right">' +
            '<span class="ytplus-quality">—</span>' +
            '<button class="ytplus-icon" data-act="help" type="button">?</button>' +
            '<button class="ytplus-icon ytplus-collapse" type="button">–</button>' +
          "</div>" +
        "</div>" +
        '<div class="ytplus-body"></div>' +
      "</div>"
    );

    const body = panel.querySelector(".ytplus-body");
    qualityBadge = panel.querySelector(".ytplus-quality");

    const switches = node('<div class="ytplus-row"></div>');
    [
      ["ads", "Ads"],
      ["qualityLock", "Max quality"],
      ["autoSpeed", "Smart speed"],
      ["sponsorblock", "Sponsors"],
      ["nsfwVideo", "NSFW"],
      ["musicBlur", "Music blur"]
    ].forEach(([key, label]) => switches.appendChild(toggle(key, label)));
    body.appendChild(switches);

    const speedCard = node(
      '<div class="ytplus-card">' +
        '<div class="ytplus-card-head">Smart speed <b class="ytplus-speed">1.00×</b> <span class="ytplus-reason">idle</span></div>' +
        '<div class="ytplus-row">' +
          '<select class="ytplus-select" data-key="autoSpeedMode">' +
            '<option value="light">Light</option>' +
            '<option value="balanced">Balanced</option>' +
            '<option value="aggressive">Aggressive</option>' +
          "</select>" +
        "</div>" +
      "</div>"
    );
    speedValue = speedCard.querySelector(".ytplus-speed");
    speedReason = speedCard.querySelector(".ytplus-reason");
    const modeSelect = speedCard.querySelector("select");
    modeSelect.value = yt.settings.autoSpeedMode;
    modeSelect.addEventListener("change", () => yt.set("autoSpeedMode", modeSelect.value));
    speedCard.querySelector(".ytplus-row").appendChild(numberField("autoSpeedMin", "min", 0.05, 0.5, 2));
    speedCard.querySelector(".ytplus-row").appendChild(numberField("autoSpeedMax", "max", 0.05, 1, 4));
    body.appendChild(speedCard);

    const nsfwCard = node(
      '<div class="ytplus-card">' +
        '<div class="ytplus-card-head">NSFW detection <span class="ytplus-nsfw-state">analysing…</span></div>' +
        '<div class="ytplus-row">' +
          '<button class="ytplus-btn" data-act="nsfw-rescan" type="button">Rescan</button>' +
          '<button class="ytplus-btn" data-act="nsfw-reveal" type="button">Show</button>' +
        "</div>" +
      "</div>"
    );
    nsfwBadge = nsfwCard.querySelector(".ytplus-nsfw-state");
    nsfwCard.querySelector('[data-act="nsfw-rescan"]').addEventListener("click", () => window.YTPlusNsfw.rescan());
    nsfwCard.querySelector('[data-act="nsfw-reveal"]').addEventListener("click", () => window.YTPlusNsfw.reset());
    body.appendChild(nsfwCard);

    const eqCard = node(
      '<details class="ytplus-card">' +
        "<summary>Equalizer</summary>" +
        '<div class="ytplus-row">' +
          '<label class="ytplus-switch"><input type="checkbox" class="ytplus-eq-toggle"><i></i><span>On</span></label>' +
          '<select class="ytplus-preset"></select>' +
          '<span class="ytplus-badge">Pre <input type="number" class="ytplus-number ytplus-preamp" step="1" min="-12" max="12"></span>' +
          '<span class="ytplus-badge">Boost <input type="range" class="ytplus-boost" min="100" max="300" step="10"></span>' +
          '<b class="ytplus-boost-value">100%</b>' +
        "</div>" +
        '<div class="ytplus-bands"></div>' +
      "</details>"
    );
    body.appendChild(eqCard);

    const audio = window.YTPlusAudio;
    if (audio) {
      const preset = eqCard.querySelector(".ytplus-preset");
      Object.keys(audio.presets).forEach((key) => preset.appendChild(new Option(key, key)));
      preset.value = yt.settings.eqPreset;
      preset.addEventListener("change", () => audio.applyPreset(preset.value));

      const eqToggle = eqCard.querySelector(".ytplus-eq-toggle");
      eqToggle.checked = !!yt.settings.eqEnabled;
      eqToggle.addEventListener("change", () => audio.toggleEq(eqToggle.checked));

      const preamp = eqCard.querySelector(".ytplus-preamp");
      preamp.value = yt.settings.eqPreamp;
      preamp.addEventListener("change", () => audio.setPreamp(parseFloat(preamp.value) || 0));

      const boost = eqCard.querySelector(".ytplus-boost");
      const boostValue = eqCard.querySelector(".ytplus-boost-value");
      boost.value = yt.settings.boost;
      boostValue.textContent = yt.settings.boost + "%";
      boost.addEventListener("input", () => {
        boostValue.textContent = boost.value + "%";
        audio.setBoost(parseInt(boost.value, 10));
      });

      const bandWrap = eqCard.querySelector(".ytplus-bands");
      audio.labels.forEach((label, index) => {
        const band = node(
          '<div class="ytplus-band"><input type="range" min="-12" max="12" step="0.5" data-band="' +
          index + '"><span>' + label + "</span></div>"
        );
        const range = band.querySelector("input");
        range.value = yt.settings.eqBands[index] || 0;
        range.addEventListener("input", () => audio.setBand(index, parseFloat(range.value)));
        bandWrap.appendChild(band);
      });

      yt.on("eq:bands", (event) => {
        eqCard.querySelectorAll("[data-band]").forEach((range) => {
          range.value = event.detail[parseInt(range.dataset.band, 10)] || 0;
        });
      });
    } else {
      eqCard.querySelector("summary").textContent = "Equalizer unavailable";
    }

    const toolRow = node(
      '<div class="ytplus-row">' +
        '<button class="ytplus-btn" data-act="shot" type="button">Frame</button>' +
        '<button class="ytplus-btn" data-act="clip" type="button">Clip 5s</button>' +
        '<button class="ytplus-btn" data-act="loop-a" type="button">A</button>' +
        '<button class="ytplus-btn" data-act="loop-b" type="button">B</button>' +
        '<button class="ytplus-btn" data-act="loop-clear" type="button">Clear</button>' +
        '<button class="ytplus-btn" data-act="focus" type="button">Focus</button>' +
        '<button class="ytplus-btn" data-act="gif" type="button">GIF</button>' +
      "</div>"
    );
    body.appendChild(toolRow);

    const sleepRow = node(
      '<div class="ytplus-row">' +
        '<span class="ytplus-badge">Sleep <select class="ytplus-select ytplus-sleep">' +
          '<option value="0">off</option><option value="15">15m</option>' +
          '<option value="30">30m</option><option value="60">1h</option>' +
        "</select></span>" +
        '<button class="ytplus-btn" data-act="undo-skip" type="button">Undo skip</button>' +
      "</div>"
    );
    body.appendChild(sleepRow);
    sleepRow.querySelector(".ytplus-sleep").addEventListener("change", (event) =>
      window.YTPlusTools.setSleep(parseInt(event.target.value, 10))
    );
    sleepRow.querySelector('[data-act="undo-skip"]').addEventListener("click", () => window.YTPlusSponsor.undo());

    const summaryRow = node(
      '<div class="ytplus-row">' +
        '<button class="ytplus-btn ytplus-primary" data-act="summary" type="button">Summarise with Gemini</button>' +
        '<button class="ytplus-btn" data-act="copy" type="button" hidden>Copy</button>' +
        '<button class="ytplus-btn" data-act="clear" type="button" hidden>Clear</button>' +
      "</div>"
    );
    body.appendChild(summaryRow);
    summaryBox = node('<div class="ytplus-summary" hidden></div>');
    body.appendChild(summaryBox);

    const summaryButton = summaryRow.querySelector('[data-act="summary"]');
    const copyButton = summaryRow.querySelector('[data-act="copy"]');
    const clearButton = summaryRow.querySelector('[data-act="clear"]');

    summaryButton.addEventListener("click", async () => {
      summaryButton.disabled = true;
      summaryButton.textContent = "Summarising…";
      summaryBox.hidden = false;
      copyButton.hidden = false;
      clearButton.hidden = false;
      summaryBox.textContent = "Fetching transcript…";
      try {
        summaryBox.textContent = await window.YTPlusSummary.run();
      } catch (error) {
        summaryBox.textContent = "Error: " + error.message;
      } finally {
        summaryButton.disabled = false;
        summaryButton.textContent = "Summarise with Gemini";
      }
    });

    copyButton.addEventListener("click", async () => {
      await navigator.clipboard.writeText(summaryBox.textContent);
      yt.toast("Copied", "ok");
    });

    clearButton.addEventListener("click", () => {
      summaryBox.hidden = true;
      summaryBox.textContent = "";
      copyButton.hidden = true;
      clearButton.hidden = true;
    });

    panel.querySelector(".ytplus-collapse").addEventListener("click", () => panel.classList.toggle("collapsed"));
    panel.querySelector('[data-act="help"]').addEventListener("click", () => window.YTPlusTools.showShortcuts());
    toolRow.querySelector('[data-act="shot"]').addEventListener("click", () => window.YTPlusTools.screenshot());
    toolRow.querySelector('[data-act="clip"]').addEventListener("click", () => window.YTPlusTools.startClip(5));
    toolRow.querySelector('[data-act="loop-a"]').addEventListener("click", () => window.YTPlusTools.markLoop("a"));
    toolRow.querySelector('[data-act="loop-b"]').addEventListener("click", () => window.YTPlusTools.markLoop("b"));
    toolRow.querySelector('[data-act="loop-clear"]').addEventListener("click", () => window.YTPlusTools.clearLoop());
    toolRow.querySelector('[data-act="focus"]').addEventListener("click", () => {
      yt.set("focusMode", !yt.settings.focusMode);
      document.documentElement.classList.toggle("ytplus-focus", yt.settings.focusMode);
    });
    toolRow.querySelector('[data-act="gif"]').addEventListener("click", () => window.YTPlusGif.open());

    yt.on("autospeed:state", (event) => {
      speedValue.textContent = event.detail.rate.toFixed(2) + "×";
      speedReason.textContent = event.detail.reason;
    });

    yt.on("quality:stats", (event) => {
      const detail = event.detail;
      qualityBadge.textContent =
        (detail.label || detail.quality || "—") +
        (detail.fps ? " " + detail.fps + "fps" : "") +
        (detail.bitrate ? " " + Math.round(detail.bitrate / 1000) + "kbps" : "");
      qualityBadge.title =
        "now " + (detail.dimensions || "?") + " " + (detail.codecs || "") +
        " · source max " + (detail.sourceHeight || "?") + "p" + (detail.sourceFps || "");
      qualityBadge.classList.toggle("weak", !!detail.sourceHeight && parseInt(detail.label, 10) < detail.sourceHeight);
    });

    yt.on("nsfw:score", (event) => {
      const percent = Math.round(event.detail.score * 100);
      nsfwBadge.textContent = event.detail.decision + " " + percent + "%";
      nsfwBadge.dataset.decision = event.detail.decision;
    });

    anchor.parentNode.insertBefore(panel, anchor);
    if (!yt.settings.panelOpen) panel.classList.add("collapsed");
  }

  function destroy() {
    panel?.remove();
    panel = null;
  }

  yt.on("ready", () => setTimeout(build, 1200));
  yt.onNavigate(() => setTimeout(build, 1500));
  yt.on("settings", (event) => {
    if ("enabled" in event.detail) {
      event.detail.enabled.newValue ? setTimeout(build, 300) : destroy();
    }
  });
})();