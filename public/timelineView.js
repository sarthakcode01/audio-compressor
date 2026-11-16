/**
 * Timeline View: Virtualized Rendering for Ruler, Clips Track, and Playhead
 * Guaranteed GPU-safe: Canvases never exceed viewport texture limits.
 */

import { formatTime } from './audioEngine.js';

export class TimelineView {
  constructor(container, timeline, callbacks = {}) {
    this.container = container;
    this.timeline = timeline;
    this.callbacks = {
      onSeek: callbacks.onSeek || (() => {}),
      onClipSelect: callbacks.onClipSelect || (() => {}),
      onClipChange: callbacks.onClipChange || (() => {})
    };

    this.rulerCanvas = container.querySelector('#timeline-ruler-canvas');
    this.trackLane = container.querySelector('#timeline-track-lane');
    this.playhead = container.querySelector('#timeline-playhead');
    this.scrollArea = container.querySelector('#timeline-scroll-area');
    this.rulerContainer = container.querySelector('#ruler-container');

    this.isScrubbing = false;
    this.draggedClipId = null;
    this.dragStartX = 0;
    this.clipStartTimeline = 0;
    this.resizeEdge = null; // 'start' | 'end' | null

    this.initEvents();
  }

  /**
   * Updates full visual render
   */
  render() {
    this.updateTrackDimensions();
    this.drawVisibleRuler();
    this.renderClips();
    this.updatePlayheadPosition();
  }

  /**
   * Sets track virtual scroll dimensions safely
   */
  updateTrackDimensions() {
    const viewportWidth = Math.max(this.scrollArea.clientWidth || 360, 320);
    const totalDuration = Math.max(this.timeline.getTotalDuration() + 10, 30);
    const totalWidth = Math.max(totalDuration * this.timeline.zoom, viewportWidth);

    // Track lane gets full virtual width for horizontal scrolling
    this.trackLane.style.width = `${totalWidth}px`;
    if (this.rulerContainer) {
      this.rulerContainer.style.width = `${totalWidth}px`;
    }

    // Ruler canvas is locked to the physical viewport (never exceeds GPU limits)
    const safeCanvasWidth = Math.min(viewportWidth, 2048);
    if (this.rulerCanvas.width !== safeCanvasWidth) {
      this.rulerCanvas.width = safeCanvasWidth;
      this.rulerCanvas.height = 32;
    }
  }

  /**
   * Virtualized ruler rendering: only draws ticks in the visible viewport window
   */
  drawVisibleRuler() {
    const ctx = this.rulerCanvas.getContext('2d');
    const viewportWidth = this.rulerCanvas.width;
    ctx.clearRect(0, 0, viewportWidth, 32);

    // Background
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, viewportWidth, 32);

    // Bottom border
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 31.5);
    ctx.lineTo(viewportWidth, 31.5);
    ctx.stroke();

    const scrollLeft = this.scrollArea.scrollLeft;
    const zoom = this.timeline.zoom;

    // Visible time bounds with small margin
    const timeStart = Math.max(0, (scrollLeft - 80) / zoom);
    const timeEnd = (scrollLeft + viewportWidth + 80) / zoom;

    // Adaptive intervals based on zoom level
    let majorInterval = 5;
    let minorDivisions = 5;

    if (zoom < 0.2) {
      majorInterval = 600; // 10 min
      minorDivisions = 5;
    } else if (zoom < 0.8) {
      majorInterval = 300; // 5 min
      minorDivisions = 5;
    } else if (zoom < 3) {
      majorInterval = 60;  // 1 min
      minorDivisions = 4;
    } else if (zoom < 10) {
      majorInterval = 15;  // 15 sec
      minorDivisions = 3;
    } else if (zoom < 30) {
      majorInterval = 5;   // 5 sec
      minorDivisions = 5;
    } else if (zoom > 80) {
      majorInterval = 1;   // 1 sec
      minorDivisions = 5;
    }

    const minorInterval = majorInterval / minorDivisions;
    const firstMinor = Math.floor(timeStart / minorInterval) * minorInterval;

    // Minor ticks
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1;
    for (let t = firstMinor; t <= timeEnd; t += minorInterval) {
      const screenX = (t * zoom) - scrollLeft;
      if (screenX >= 0 && screenX <= viewportWidth) {
        ctx.beginPath();
        ctx.moveTo(screenX + 0.5, 22);
        ctx.lineTo(screenX + 0.5, 30);
        ctx.stroke();
      }
    }

    // Major ticks & labels
    const firstMajor = Math.floor(timeStart / majorInterval) * majorInterval;
    ctx.strokeStyle = '#94a3b8';
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px JetBrains Mono, monospace';
    ctx.textAlign = 'left';

    for (let t = firstMajor; t <= timeEnd; t += majorInterval) {
      const screenX = (t * zoom) - scrollLeft;
      if (screenX >= 0 && screenX <= viewportWidth) {
        ctx.beginPath();
        ctx.moveTo(screenX + 0.5, 12);
        ctx.lineTo(screenX + 0.5, 30);
        ctx.stroke();

        const timeLabel = formatTime(t);
        ctx.fillText(timeLabel, screenX + 4, 18);
      }
    }
  }

  /**
   * Renders clip blocks on the track lane
   */
  renderClips() {
    this.trackLane.innerHTML = '';
    const zoom = this.timeline.zoom;

    if (this.timeline.clips.length === 0) {
      const emptyMsg = document.createElement('div');
      emptyMsg.className = 'timeline-empty-msg';
      emptyMsg.textContent = 'Tap "+ Add Audio" or drop files here';
      this.trackLane.appendChild(emptyMsg);
      return;
    }

    this.timeline.clips.forEach(clip => {
      const clipEl = document.createElement('div');
      clipEl.className = 'timeline-clip';
      if (clip.id === this.timeline.selectedClipId) {
        clipEl.classList.add('selected');
      }

      const leftPx = clip.startOnTimeline * zoom;
      const widthPx = Math.max(clip.duration * zoom, 24);

      clipEl.style.left = `${leftPx}px`;
      clipEl.style.width = `${widthPx}px`;
      clipEl.style.backgroundColor = clip.color || '#0284c7';
      clipEl.dataset.clipId = clip.id;

      // Header Bar
      const header = document.createElement('div');
      header.className = 'clip-header';
      header.innerHTML = `
        <span class="clip-name" title="${clip.name}">${clip.name}</span>
        <span class="clip-dur">${clip.duration.toFixed(1)}s</span>
      `;
      clipEl.appendChild(header);

      // GPU-Safe Waveform Canvas (Clamped to max 1200px internal buffer)
      const waveCanvas = document.createElement('canvas');
      waveCanvas.className = 'clip-waveform-canvas';
      waveCanvas.width = Math.min(Math.max(Math.floor(widthPx), 40), 1200);
      waveCanvas.height = 60;
      this.drawClipWaveform(waveCanvas, clip);
      clipEl.appendChild(waveCanvas);

      // Trim Handles
      const leftHandle = document.createElement('div');
      leftHandle.className = 'clip-trim-handle handle-left';
      leftHandle.title = 'Drag to trim start';

      const rightHandle = document.createElement('div');
      rightHandle.className = 'clip-trim-handle handle-right';
      rightHandle.title = 'Drag to trim end';

      clipEl.appendChild(leftHandle);
      clipEl.appendChild(rightHandle);

      this.trackLane.appendChild(clipEl);
    });
  }

  /**
   * Draws the waveform inside a clip block
   */
  drawClipWaveform(canvas, clip) {
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);

    if (clip.buffer) {
      const channelData = clip.buffer.getChannelData(0);
      const sampleRate = clip.buffer.sampleRate;
      const startSample = Math.floor(clip.offsetInSource * sampleRate);
      const endSample = Math.min(
        Math.floor((clip.offsetInSource + clip.duration) * sampleRate),
        channelData.length
      );
      const totalSamples = endSample - startSample;
      if (totalSamples <= 0) return;

      const step = Math.max(1, Math.floor(totalSamples / width));
      const centerY = height / 2;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';

      for (let x = 0; x < width; x++) {
        const idx = startSample + (x * step);
        let max = 0;
        for (let j = 0; j < step && (idx + j) < endSample; j++) {
          const val = Math.abs(channelData[idx + j]);
          if (val > max) max = val;
        }
        const barH = Math.max(2, max * (height * 0.9));
        ctx.fillRect(x, centerY - barH / 2, 1, barH);
      }
    } else if (clip.mediaAsset && clip.mediaAsset.peaks) {
      const peaks = clip.mediaAsset.peaks;
      const totalDur = clip.mediaAsset.duration || clip.duration;
      const startFrac = Math.max(0, clip.offsetInSource / totalDur);
      const endFrac = Math.min(1, (clip.offsetInSource + clip.duration) / totalDur);
      const sliceFrac = Math.max(0.0001, endFrac - startFrac);

      const centerY = height / 2;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';

      for (let x = 0; x < width; x++) {
        const frac = startFrac + (x / width) * sliceFrac;
        const pIdx = Math.min(peaks.length - 1, Math.floor(frac * peaks.length));
        const peakVal = peaks[pIdx] || 0.4;
        const barH = Math.max(3, peakVal * (height * 0.85));
        ctx.fillRect(x, centerY - barH / 2, 1, barH);
      }
    }
  }

  /**
   * Updates playhead element location
   */
  updatePlayheadPosition(time = this.timeline.playheadTime) {
    const x = time * this.timeline.zoom;
    this.playhead.style.transform = `translateX(${x}px)`;
  }

  initEvents() {
    // 1. Repaint visible ruler on scroll
    this.scrollArea.addEventListener('scroll', () => {
      this.drawVisibleRuler();
    }, { passive: true });

    // Window resize
    window.addEventListener('resize', () => {
      this.updateTrackDimensions();
      this.drawVisibleRuler();
    });

    // 2. Scrubbing via Ruler or Track (Mouse & Touch)
    const handleScrub = (clientX) => {
      const rect = this.scrollArea.getBoundingClientRect();
      const scrollLeft = this.scrollArea.scrollLeft;
      const x = clientX - rect.left + scrollLeft;
      const newTime = Math.max(0, x / this.timeline.zoom);
      this.timeline.playheadTime = newTime;
      this.updatePlayheadPosition(newTime);
      this.callbacks.onSeek(newTime);
    };

    const onPointerDown = (e) => {
      const clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : null);
      if (clientX === null) return;
      this.isScrubbing = true;
      handleScrub(clientX);
    };

    const onPointerMove = (e) => {
      const clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : null);
      if (clientX === null) return;

      if (this.isScrubbing) {
        handleScrub(clientX);
      } else if (this.draggedClipId && !this.resizeEdge) {
        const deltaPx = clientX - this.dragStartX;
        const deltaSec = deltaPx / this.timeline.zoom;
        const newStart = Math.max(0, this.clipStartTimeline + deltaSec);
        this.timeline.moveClip(this.draggedClipId, newStart);
        this.renderClips();
      } else if (this.draggedClipId && this.resizeEdge) {
        const deltaPx = clientX - this.dragStartX;
        const deltaSec = deltaPx / this.timeline.zoom;
        this.timeline.adjustClipEdge(this.draggedClipId, this.resizeEdge, deltaSec);
        this.dragStartX = clientX;
        this.renderClips();
      }
    };

    const onPointerUp = () => {
      if (this.isScrubbing) {
        this.isScrubbing = false;
      }
      if (this.draggedClipId) {
        this.draggedClipId = null;
        this.resizeEdge = null;
        this.callbacks.onClipChange();
      }
    };

    // Ruler scrubbing
    this.rulerCanvas.addEventListener('mousedown', onPointerDown);
    this.rulerCanvas.addEventListener('touchstart', onPointerDown, { passive: true });

    window.addEventListener('mousemove', onPointerMove);
    window.addEventListener('touchmove', onPointerMove, { passive: true });

    window.addEventListener('mouseup', onPointerUp);
    window.addEventListener('touchend', onPointerUp);

    // 3. Track Lane Clip Interactivity
    const onTrackPointerDown = (e) => {
      const clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : null);
      if (clientX === null) return;

      const clipEl = e.target.closest('.timeline-clip');
      if (!clipEl) {
        this.isScrubbing = true;
        handleScrub(clientX);
        return;
      }

      const clipId = clipEl.dataset.clipId;
      this.timeline.selectedClipId = clipId;
      this.renderClips();
      this.callbacks.onClipSelect(this.timeline.getSelectedClip());

      if (e.target.classList.contains('handle-left')) {
        this.draggedClipId = clipId;
        this.resizeEdge = 'start';
        this.dragStartX = clientX;
      } else if (e.target.classList.contains('handle-right')) {
        this.draggedClipId = clipId;
        this.resizeEdge = 'end';
        this.dragStartX = clientX;
      } else {
        this.draggedClipId = clipId;
        this.resizeEdge = null;
        this.dragStartX = clientX;
        const clip = this.timeline.getClipById(clipId);
        this.clipStartTimeline = clip ? clip.startOnTimeline : 0;
      }
    };

    this.trackLane.addEventListener('mousedown', onTrackPointerDown);
    this.trackLane.addEventListener('touchstart', onTrackPointerDown, { passive: true });
  }
}
