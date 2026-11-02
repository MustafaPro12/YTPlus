const CATEGORIES = [
  ["sponsor", "Sponsor"],
  ["selfpromo", "Self promo"],
  ["interaction", "Interaction"],
  ["intro", "Intro"],
  ["outro", "Outro"],
  ["preview", "Preview"],
  ["music_offtopic", "Off-topic music"]
];

const FIELDS = [
  "geminiKey", "geminiModel", "giphyKey", "nsfwThreshold",
  "autoSpeedMin", "autoSpeedMax", "autoSpeedBase", "autoSpeedMode", "musicBlurAmount"
];

const CHECKS = ["nsfwThumbs", "hideShortsShelf", "dimPage", "debug"];

function flash() {
  const element = document.getElementById("saved");
  element.textContent = "Saved";
  setTimeout(() => (element.textContent = ""), 1100);
}

chrome.storage.local.get([...FIELDS, ...CHECKS, "sponsorCategories"]).then((stored) => {
  for (const field of FIELDS) {
    const element = document.getElementById(field);
    if (element && stored[field] !== undefined) element.value = stored[field];
  }
  for (const key of CHECKS) {
    const element = document.getElementById(key);
    if (element) element.checked = !!stored[key];
  }
  const active = stored.sponsorCategories || CATEGORIES.map((entry) => entry[0]);
  const host = document.getElementById("categories");
  for (const [id, label] of CATEGORIES) {
    const wrapper = document.createElement("label");
    wrapper.className = "inline";
    wrapper.innerHTML = '<input type="checkbox" value="' + id + '"><span>' + label + "</span>";
    const box = wrapper.querySelector("input");
    box.checked = active.includes(id);
    box.addEventListener("change", () => {
      const picked = [...document.querySelectorAll("#categories input:checked")].map((item) => item.value);
      chrome.storage.local.set({ sponsorCategories: picked });
      flash();
    });
    host.appendChild(wrapper);
  }
});

for (const field of FIELDS) {
  const element = document.getElementById(field);
  if (!element) continue;
  element.addEventListener("change", () => {
    const value = element.type === "number" ? parseFloat(element.value) : element.value;
    chrome.storage.local.set({ [field]: value });
    flash();
  });
}

for (const key of CHECKS) {
  const element = document.getElementById(key);
  if (!element) continue;
  element.addEventListener("change", () => {
    chrome.storage.local.set({ [key]: element.checked });
    flash();
  });
}