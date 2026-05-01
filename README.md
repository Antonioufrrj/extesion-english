# YouTube Click Highlighter

A Chrome extension that enhances your YouTube learning experience by making subtitles interactive. Click on any word in the video captions to highlight it with colors — similar to Language Reactor.

## Features

- **Clickable captions** — Words in the YouTube subtitle overlay become individually clickable
- **Color cycle** — Click a word to cycle through: no color → green → yellow → no color
- **Persistent highlights** — Marked words are saved and automatically highlighted every time they appear in any video
- **Sidebar panel** — A collapsible side panel with two tabs:
  - **Legendas** — Shows the current subtitle text with color highlights
  - **Palavras Salvas** — Shows the top 20 most frequent words (excluding green-marked words), clickable to assign colors
- **Word frequency tracking** — Counts how many times each word appears across all videos, stored persistently
- **Sync between caption and sidebar** — Marking a word in one place reflects everywhere instantly

## Color Meaning

| Color  | Meaning |
|--------|---------|
| 🟢 Green  | Known word — excluded from frequency tracking |
| 🟡 Yellow | Word to study — tracked and shown in saved words |
| No color | Neutral — tracked for frequency analysis |

## Installation

1. Clone or download this repository
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked** and select the project folder
5. Open any YouTube video with subtitles enabled

## Usage

- Click the **≡** button on the right side of the screen to open/close the panel
- Click any word in the video subtitle to highlight it
- Switch to the **Palavras Salvas** tab to see your most frequent words
- Click words in the saved tab to assign colors — they will be highlighted in future captions automatically

## Tech Stack

- Vanilla JavaScript (no frameworks)
- Chrome Extension Manifest V3
- `chrome.storage.local` for persistent word colors and frequency data
- `MutationObserver` for real-time caption detection

## File Structure

```
├── manifest.json   # Chrome extension manifest (MV3)
├── content.js      # Main extension logic
└── style.css       # Styles for sidebar and caption highlights
```

## Roadmap

- [ ] Word frequency analytics dashboard
- [ ] Export saved words list
- [ ] Filter words by color in the saved tab
- [ ] Support for multiple languages
