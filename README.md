# Audio Timeline Studio (Video Editor / NLE Style)

A lightweight, zero-dependency, timeline-based audio editor with visual waveforms, scrubbable playhead, split/trim tools, and master audio export.

## Features

### 1. Unified Multi-Clip Timeline
- **Sticky Time Ruler**: Scaled in minutes, seconds, and milliseconds (`00:00`, `00:05`, `00:10`).
- **Scrubbable Playhead (Cursor)**: Click or drag anywhere along the ruler or timeline to inspect that exact time frame and hear the audio.
- **Dynamic Waveform Blocks**: Audio files render as draggable clip blocks with waveforms, title tags, and duration readouts.

### 2. Video Editor / NLE Editing Operations
- **Split at Playhead (`S` or Split Button)**: Cut any clip under the playhead into two independent left and right pieces.
- **Trim Left (`Q` or Trim Left Button)**: Delete everything from the clip's start up to the current playhead.
- **Trim Right (`W` or Trim Right Button)**: Delete everything from the playhead to the clip's end.
- **Delete Clip (`Delete` / `Backspace` or Delete Button)**: Removes the selected clip and ripples subsequent clips to close the gap.
- **Interactive Edge Trimming**: Hover and drag the left or right edges of any clip to visually adjust in/out trim points.
- **Rearrange & Magnetic Snapping**: Drag clips horizontally along the timeline with automatic snapping to neighboring clips and the playhead.
- **Undo (`Ctrl+Z`)**: Revert any accidental cut or edit.

### 3. Clip Inspector & Master WAV Export
- **Per-Clip Controls**:
  - Individual Volume / Gain slider (0% to 200%).
  - Fade In & Fade Out duration sliders (0.0s to 3.0s).
- **Master Export**: Combines and renders all timeline clips at their exact positions and fades into a single seamless 16-bit PCM `.wav` file.

---

## Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Space` | Play / Pause playback from playhead |
| `S` | **Split** clip at playhead into 2 parts |
| `Q` | **Trim Left** (Cut from start to playhead) |
| `W` | **Trim Right** (Cut from playhead to end) |
| `Del` / `Backspace` | **Delete** selected clip |
| `Ctrl + Z` | **Undo** last timeline action |
| `←` / `→` | Step playhead backward / forward by 0.1s |
| `Home` | Jump playhead to start (00:00.00) |

---

## How to Run & Use

1. Ensure the server is running:
   ```bash
   node server.js
   ```
2. Open your web browser to:
   ```
   http://localhost:3000
   ```
3. Click **"+ Add Audio"** (or drag & drop audio files directly onto the timeline).
   *(Sample files `sample_chime.wav` and `sample_melody.wav` are ready in the folder for instant testing).*
