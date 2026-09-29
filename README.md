# Bloom Focus ✿

A cozy focus/break timer for Chrome with calm generative lofi music and a floating mini timer on
LeetCode, GeeksforGeeks, NeetCode and Hello Interview.

## Install (developer mode)

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and pick this folder
4. Pin Bloom Focus from the puzzle-piece menu

After editing any file, hit the ↻ reload button on the extension card (and refresh open coding tabs).

## Files

| File | What it does |
| --- | --- |
| `background.js` | Timer state machine, alarms, badge, notifications, daily stats |
| `popup.*` | The main popup UI |
| `widget.js` | Floating timer injected on the coding sites |
| `offscreen.*` | Generates the background music and chimes with Web Audio |
| `shared.js` | Defaults and small helpers |

To add another site, add its pattern to `content_scripts.matches` in `manifest.json`.
