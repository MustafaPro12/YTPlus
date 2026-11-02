# YTPlus+ 3.0

Install: chrome://extensions → Developer mode → Load unpacked → this folder.

Shortcuts (Shift + key, video focused):
. speed up · , slow down · 0 reset · A smart speed · B NSFW · M music blur
E equalizer · S screenshot · C record clip · G GIF picker · F focus mode
1 loop A · 2 loop B · X clear loop · ? shortcut list

Notes:
- Settings live in storage.local with a 280 ms debounce so slider drags never hit quota.
- Quality lock reads getAvailableQualityData, sorts by height, fps and codec, applies the
  winner, verifies it 1.2 s later and re-applies on every quality change for the whole session.
- NSFW uses real pixel analysis (skin ratio over a trimmed sample window), cached per
  thumbnail in the service worker via OffscreenCanvas. Nothing is blurred by default.
- GIFs are written into YouTube's own editor with execCommand plus input/change events and
  verified by reading the editor back. The link stays plain text, so non-users get a
  clickable link too.