# YTPlus - YouTube Plus Extension

YTPlus is a lightweight, unpackaged Chrome browser extension designed to enhance and customize your YouTube experience.

## 🚀 Installation Guide

Since this is an unpackaged extension, you can easily install it in developer mode by following these steps:

1. **Download the Repository:**
   * Click on the green **"Code"** button at the top right of this repository.
   * Select **"Download ZIP"**.
2. **Extract the Files:**
   * Locate the downloaded `.zip` file on your computer.
   * Right-click the file and extract/unzip it to a folder of your choice (e.g., your Desktop or Downloads folder). Make sure you remember where you extracted it.
3. **Open Chrome Extensions Page:**
   * Open Google Chrome.
   * Type or paste `chrome://extensions/` into the address bar and press **Enter**.
4. **Enable Developer Mode:**
   * Look at the top-right corner of the Extensions page and toggle the switch for **"Developer mode"** to **ON**.
5. **Load the Unpackaged Extension:**
   * Click the **"Load unpacked"** button that appears on the top-left corner.
   * Navigate to the folder where you extracted the project files in Step 2 (`ytplus_extension`), select the folder, and click **Select Folder** (or **OK**).

🎉 **Done!** The YTPlus extension is now successfully installed. Head over to YouTube and enjoy your enhanced experience!

---

## 🛠️ Features
* Customizes and improves the standard YouTube web interface.
* Lightweight design for fast execution.
* Open-source and easy to modify locally.

## 📂 Project Structure
```text
ytplus_extension/
│
├── manifest.json       # Extension configuration file
├── background.js       # Background service worker
├── content.js          # Script injected into YouTube pages
├── popup.html          # Extension popup UI
├── popup.js            # Logic for the popup UI
└── icons/              # Extension icons and assets```
