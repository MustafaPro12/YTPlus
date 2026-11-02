const KEYS = [
  "enabled", "ads", "qualityLock", "autoSpeed", "sponsorblock",
  "nsfwVideo", "musicBlur", "audio", "gifComments", "cleanUi"
];

chrome.storage.local.get(KEYS).then((stored) => {
  for (const key of KEYS) {
    const element = document.getElementById(key);
    element.checked = stored[key] !== false;
    element.addEventListener("change", () => chrome.storage.local.set({ [key]: element.checked }));
  }
});

document.getElementById("options").addEventListener("click", () => chrome.runtime.openOptionsPage());

chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
  const url = tab?.url || "";
  const label = document.getElementById("state");
  if (/[?&]v=[\w-]+/.test(url)) label.textContent = "Video detected";
  else if (url.includes("youtube.com")) label.textContent = "YouTube";
  else label.textContent = "Not a YouTube page";
});