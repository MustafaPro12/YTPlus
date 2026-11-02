(() => {
  const yt = window.YTPlus;
  if (!yt) return;

  const GIF_PATTERN =
    /https?:\/\/(?:media\d*\.giphy\.com|media\.giphy\.com|i\.giphy\.com|media\.tenor\.com|c\.tenor\.com)\/[^\s"'<)]+\.(?:gif|webp|mp4)/i;
  const SHORT_PATTERN = /https?:\/\/(?:is\.gd|tinyurl\.com)\/[\w-]+/i;

  const blobCache = new Map();
  const pendingNodes = new Set();
  let mutationObserver = null;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function normalizeGifUrl(raw) {
    if (!raw) return null;
    let url = String(raw).split("#")[0].split("?")[0].trim();
    if (url.startsWith("http://")) url = "https://" + url.slice(7);
    const short = url.match(/^https:\/\/i\.giphy\.com\/([\w]+)\.gif$/);
    if (short) url = "https://media.giphy.com/media/" + short[1] + "/giphy.gif";
    return url;
  }

  async function toBlobUrl(url) {
    if (blobCache.has(url)) return blobCache.get(url);
    const response = await chrome.runtime.sendMessage({ type: "gif:fetch", url });
    if (!response?.ok) return url;
    const binary = atob(response.data.base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    const blob = new Blob([bytes], { type: response.data.mime });
    const blobUrl = URL.createObjectURL(blob);
    blobCache.set(url, blobUrl);
    return blobUrl;
  }

  function findEditor() {
    return (
      document.querySelector("ytd-commentbox #contenteditable-root") ||
      document.querySelector("ytd-comment-simplebox-renderer #contenteditable-root") ||
      document.querySelector("#contenteditable-root") ||
      document.querySelector("ytd-commentbox [contenteditable]") ||
      document.querySelector("ytd-comment-simplebox-renderer [contenteditable]")
    );
  }

  function findSubmitButton() {
    return (
      document.querySelector("ytd-commentbox #submit-button") ||
      document.querySelector("ytd-comment-simplebox-renderer #submit-button") ||
      document.querySelector("#submit-button")
    );
  }

  function moveCaretToEnd(editor) {
    editor.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function writeInto(editor, text) {
    let inserted = false;
    try {
      inserted = document.execCommand("insertText", false, text);
    } catch {
      inserted = false;
    }
    if (!inserted) {
      const selection = window.getSelection();
      if (selection.rangeCount) {
        const range = selection.getRangeAt(0);
        const node = document.createTextNode(text);
        range.insertNode(node);
        range.setStartAfter(node);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
    editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    editor.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function pasteInto(editor, text) {
    editor.focus();
    try {
      await navigator.clipboard.writeText(text);
    } catch {}
    try {
      const transfer = new DataTransfer();
      transfer.setData("text/plain", text);
      const event = new ClipboardEvent("paste", {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true
      });
      return editor.dispatchEvent(event) === false;
    } catch {
      return false;
    }
  }

  function editorText(editor) {
    return editor.textContent || "";
  }

  function countOccurrences(haystack, needle) {
    let count = 0;
    let index = 0;
    while ((index = haystack.indexOf(needle, index)) !== -1) {
      count++;
      index += needle.length;
    }
    return count;
  }

  async function waitForText(editor, needle, timeout) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (countOccurrences(editorText(editor), needle) >= 1) return true;
      await sleep(90);
    }
    return false;
  }

  async function copyToClipboard(url) {
    try {
      await navigator.clipboard.writeText(url);
      return true;
    } catch {
      return false;
    }
  }

  function saveRecent(url) {
    chrome.storage.local.get({ gifRecent: [] }).then(({ gifRecent }) => {
      const next = [url, ...gifRecent.filter((item) => item !== url)].slice(0, 16);
      chrome.storage.local.set({ gifRecent: next });
    });
  }

  function saveLink(shortUrl, fullUrl) {
    chrome.storage.local.get({ gifLinks: {} }).then(({ gifLinks }) => {
      const next = { ...gifLinks, [shortUrl]: fullUrl };
      chrome.storage.local.set({ gifLinks: next });
    });
  }

  async function submitComment() {
    await sleep(240);
    const button = findSubmitButton();
    if (!button) return false;
    if (button.disabled || button.getAttribute("aria-disabled") === "true") return false;
    button.click();
    return true;
  }

  function findRenderedComment(needle, timeout) {
    return new Promise((resolve) => {
      const started = Date.now();
      const scan = () => {
        const nodes = [...document.querySelectorAll("ytd-comment-renderer #content-text")];
        const match = nodes.find((node) => (node.textContent || "").includes(needle));
        if (match) return resolve(match);
        if (Date.now() - started > timeout) return resolve(null);
        setTimeout(scan, 220);
      };
      scan();
    });
  }

  async function ensureLinkified(node, needle) {
    if (!node) return false;
    const anchor = node.querySelector("a[href]");
    if (anchor) return true;

    const renderer = node.closest("ytd-comment-renderer");
    if (!renderer) return false;

    const editButton = renderer.querySelector("#edit-button button, #edit-button");
    if (!editButton) return false;

    editButton.click();
    await sleep(420);

    const editBox = renderer.querySelector("#contenteditable-root");
    if (editBox) {
      moveCaretToEnd(editBox);
      writeInto(editBox, " ");
    }
    await sleep(220);

    const saveButton = renderer.querySelector("#submit-button");
    if (saveButton) saveButton.click();
    await sleep(900);

    const refreshed = [...document.querySelectorAll("ytd-comment-renderer #content-text")]
      .find((item) => (item.textContent || "").includes(needle));
    return !!refreshed?.querySelector("a[href]");
  }

  async function resolveNode(node) {
    if (pendingNodes.has(node)) return;
    pendingNodes.add(node);

    const text = node.textContent || "";
    let full = null;

    const direct = text.match(GIF_PATTERN);
    if (direct) {
      full = normalizeGifUrl(direct[0]);
    } else {
      const short = text.match(SHORT_PATTERN);
      if (short) {
        const { gifLinks = {} } = await chrome.storage.local.get({ gifLinks: {} });
        full = gifLinks[short[0]] || null;
        if (!full) {
          const response = await chrome.runtime.sendMessage({ type: "gif:resolve", url: short[0] });
          if (response?.ok && GIF_PATTERN.test(response.data)) full = response.data;
        }
      }
    }

    pendingNodes.delete(node);
    if (!full) return;

    node.dataset.ytplusGif = "1";
    const source = await toBlobUrl(full);

    const link = document.createElement("a");
    link.className = "ytplus-inline-gif-link";
    link.href = full;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.title = "Open GIF";

    const image = document.createElement("img");
    image.className = "ytplus-inline-gif";
    image.src = source;
    image.loading = "lazy";
    image.alt = "GIF";
    image.addEventListener("error", () => link.remove());

    link.appendChild(image);
    node.appendChild(link);
  }

  function renderInline(root) {
    root.querySelectorAll("#content-text:not([data-ytplus-gif])").forEach((node) => {
      const text = node.textContent || "";
      if (!GIF_PATTERN.test(text) && !SHORT_PATTERN.test(text)) return;
      resolveNode(node);
    });
  }

  async function postGif(rawUrl, options) {
    const settings = options || {};
    const full = normalizeGifUrl(rawUrl);
    if (!full) {
      yt.toast("Invalid GIF link", "warn");
      return false;
    }

    const editor = findEditor();
    if (!editor) {
      await copyToClipboard(full);
      yt.toast("Comment box not found, link copied", "warn");
      return false;
    }

    const shortenResponse = await chrome.runtime.sendMessage({ type: "gif:shorten", url: full });
    const short = shortenResponse?.ok && shortenResponse.data ? shortenResponse.data : full;
    if (short !== full) saveLink(short, full);

    const blocks = [];
    if (settings.caption && settings.caption.trim()) blocks.push(settings.caption.trim());
    blocks.push(short);

    if (countOccurrences(editorText(editor), short) === 0) {
      moveCaretToEnd(editor);
      const handled = await pasteInto(editor, blocks.join("\n"));
      let confirmed = await waitForText(editor, short, 700);

      if (!confirmed) {
        moveCaretToEnd(editor);
        writeInto(editor, (editorText(editor).trim() ? "\n" : "") + blocks.join("\n"));
        confirmed = await waitForText(editor, short, 900);
      }

      if (!confirmed && handled) {
        moveCaretToEnd(editor);
        writeInto(editor, short);
        confirmed = await waitForText(editor, short, 900);
      }

      if (!confirmed) {
        await copyToClipboard(full);
        yt.toast("Insert failed, link copied to clipboard", "warn");
        return false;
      }
    }

    await copyToClipboard(full);
    saveRecent(full);

    if (!settings.autoSubmit) {
      yt.toast("GIF inserted, press Comment", "ok");
      return true;
    }

    const submitted = await submitComment();
    if (!submitted) {
      yt.toast("GIF inserted, press Comment", "ok");
      return true;
    }

    const posted = await findRenderedComment(short, 6000);
    if (!posted) {
      yt.toast("GIF posted", "ok");
      return true;
    }

    posted.scrollIntoView({ behavior: "smooth", block: "center" });
    posted.dataset.ytplusGif = "1";
    await resolveNode(posted);

    const linked = await ensureLinkified(posted, short);
    yt.toast(linked ? "GIF posted and linked" : "GIF posted", linked ? "ok" : "warn");
    return true;
  }

  function openPicker() {
    if (document.getElementById("ytplus-gif-modal")) return;

    const modal = document.createElement("div");
    modal.id = "ytplus-gif-modal";
    modal.innerHTML =
      '<div class="ytplus-gif-panel">' +
      '<header><strong>Send a GIF</strong><button class="ytplus-gif-close" type="button">✕</button></header>' +
      '<div class="ytplus-gif-note">The GIF is posted as a short link that YouTube renders as a real hyperlink, then shown inline for you. Everyone else needs one tap.</div>' +
      '<input class="ytplus-gif-input" placeholder="Search: cat, reaction, funny…">' +
      '<input class="ytplus-gif-caption" placeholder="Optional caption (goes above the GIF)">' +
      '<div class="ytplus-gif-tabs">' +
      '<button class="ytplus-gif-tab active" data-tab="trend" type="button">Trending</button>' +
      '<button class="ytplus-gif-tab" data-tab="recent" type="button">Recent</button>' +
      '<label class="ytplus-gif-auto"><input type="checkbox" class="ytplus-gif-submit" checked> Post automatically</label>' +
      '</div>' +
      '<div class="ytplus-gif-preview" hidden></div>' +
      '<div class="ytplus-gif-grid"></div>' +
      '</div>';
    document.documentElement.appendChild(modal);

    const input = modal.querySelector(".ytplus-gif-input");
    const caption = modal.querySelector(".ytplus-gif-caption");
    const grid = modal.querySelector(".ytplus-gif-grid");
    const autoBox = modal.querySelector(".ytplus-gif-submit");
    const preview = modal.querySelector(".ytplus-gif-preview");
    const close = () => modal.remove();

    modal.querySelector(".ytplus-gif-close").addEventListener("click", close);
    modal.addEventListener("click", (event) => {
      if (event.target === modal) close();
    });
    document.addEventListener("keydown", function onEscape(event) {
      if (event.key === "Escape") {
        close();
        document.removeEventListener("keydown", onEscape);
      }
    });

    async function showPreview(url) {
      const clean = normalizeGifUrl(url);
      if (!clean) {
        preview.hidden = true;
        return;
      }
      preview.hidden = false;
      preview.innerHTML =
        '<img alt=""><code>' + clean + "</code>" +
        '<button class="ytplus-gif-copy" type="button">Copy</button>';
      preview.querySelector("img").src = await toBlobUrl(clean);
      preview.querySelector(".ytplus-gif-copy").addEventListener("click", async () => {
        await copyToClipboard(clean);
        yt.toast("Link copied", "ok");
      });
    }

    async function buildGrid(items, resolveUrl) {
      grid.innerHTML = "";
      if (!items.length) {
        grid.innerHTML = '<div class="ytplus-gif-loading">No results</div>';
        return;
      }
      for (const item of items) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "ytplus-gif-item";
        const image = document.createElement("img");
        image.alt = "";
        image.loading = "lazy";
        image.src = await toBlobUrl(item.preview);
        button.appendChild(image);
        button.addEventListener("mouseenter", () => showPreview(item.full));
        button.addEventListener("focus", () => showPreview(item.full));
        button.addEventListener("click", async () => {
          close();
          await postGif(resolveUrl ? resolveUrl(item) : item.full, {
            caption: caption.value,
            autoSubmit: autoBox.checked
          });
        });
        grid.appendChild(button);
      }
    }

    async function search(query) {
      grid.innerHTML = '<div class="ytplus-gif-loading">Searching…</div>';
      const response = await chrome.runtime.sendMessage({
        type: "gif:search",
        query,
        giphyKey: yt.settings.giphyKey
      });
      if (!response?.ok) {
        grid.innerHTML = '<div class="ytplus-gif-loading">' + (response?.error || "Error") + "</div>";
        return;
      }
      await buildGrid(response.data, null);
    }

    async function showRecent() {
      const { gifRecent = [] } = await chrome.storage.local.get({ gifRecent: [] });
      if (!gifRecent.length) {
        grid.innerHTML = '<div class="ytplus-gif-loading">Nothing sent yet</div>';
        return;
      }
      await buildGrid(
        gifRecent.map((url) => ({ preview: url, full: url })),
        null
      );
    }

    let debounce;
    input.addEventListener("input", () => {
      clearTimeout(debounce);
      const query = input.value.trim();
      if (!query) {
        showRecent();
        return;
      }
      debounce = setTimeout(() => search(query), 380);
    });

    modal.querySelectorAll(".ytplus-gif-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        modal.querySelectorAll(".ytplus-gif-tab").forEach((other) => other.classList.remove("active"));
        tab.classList.add("active");
        preview.hidden = true;
        if (tab.dataset.tab === "recent") showRecent();
        else search(input.value.trim());
      });
    });

    search("");
    input.focus();
  }

  function addButton() {
    if (!yt.settings.enabled || !yt.settings.gifComments) return;
    if (document.querySelector(".ytplus-gif-btn")) return;
    const hosts = [
      "ytd-commentbox #toolbar",
      "ytd-comment-simplebox-renderer #toolbar",
      "ytd-commentbox #buttons",
      "ytd-comment-simplebox-renderer"
    ];
    for (const selector of hosts) {
      const host = document.querySelector(selector);
      if (!host) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ytplus-gif-btn";
      button.textContent = "GIF";
      button.title = "Attach a GIF";
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openPicker();
      });
      host.appendChild(button);
      return;
    }
  }

  function observeMutations() {
    if (mutationObserver) return;
    const target = document.body;
    if (!target) {
      document.addEventListener("DOMContentLoaded", observeMutations, { once: true });
      return;
    }
    mutationObserver = new MutationObserver(() => {
      addButton();
      const comments = document.querySelector("#comments");
      if (comments) renderInline(comments);
    });
    mutationObserver.observe(target, { childList: true, subtree: true });
  }

  yt.on("ready", observeMutations);
  yt.onNavigate(() => setTimeout(() => renderInline(document), 1200));

  window.YTPlusGif = { open: openPicker, post: postGif, normalize: normalizeGifUrl };
})();