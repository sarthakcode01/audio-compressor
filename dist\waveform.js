/**
 * Waveform Visualizer & Interactive Region Selector using HTML5 Canvas
 */

export class WaveformCanvas {
  /**
   * @param {HTMLCanvasElement} canvas 
   * @param {Object} options
   */
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.buffer = null;
    this.peaks = [];
    
    // Region selection in seconds
    this.startTime = 0;
    this.endTime = 0;
    this.currentTime = 0; // Playhead position
    
    this.onRegionChange = options.onRegionChange || (() => {});
    this.onSeek = options.onSeek || (() => {});
    
    this.interactive = options.interactive !== false;
    this.activeHandle = null; // 'start', 'end', or null
    
    this.initEvents();
  }

  setBuffer(buffer) {
    this.buffer = buffer;
    this.startTime = 0;
    this.endTime = buffer ? buffer.duration : 0;
    this.currentTime = 0;
    this.calculatePeaks();
    this.draw();
  }

  setRegion(startTime, endTime) {
    if (!this.buffer) return;
    this.startTime = Math.max(0, Math.min(startTime, this.buffer.duration));
    this.endTime = Math.max(this.startTime, Math.min(endTime, this.buffer.duration));
    this.draw();
  }

  setCurrentTime(time) {
    this.currentTime = time;
    this.draw();
  }

  calculatePeaks() {
    if (!this.buffer) {
      this.peaks = [];
      return;
    }
    const width = this.canvas.width || 800;
    const channelData = this.buffer.getChannelData(0);
    const step = Math.ceil(channelData.length / width);
    this.peaks = new Float32Array(width);

    for (let i = 0; i < width; i++) {
      const start = i * step;
      const end = Math.min(start + step, channelData.length);
      let max = 0;
      for (let j = start; j < end; j++) {
        const val = Math.abs(channelData[j]);
        if (val > max) max = val;
      }
      this.peaks[i] = max;
    }
  }

  draw() {
    const { width, height } = this.canvas;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, width, height);

    if (!this.buffer || this.peaks.length === 0) {
      // Empty placeholder
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#64748b';
      ctx.font = '14px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Upload audio to view waveform', width / 2, height / 2 + 5);
      return;
    }

    const duration = this.buffer.duration;
    const startX = (this.startTime / duration) * width;
    const endX = (this.endTime / duration) * width;
    const playX = (this.currentTime / duration) * width;

    // Background
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, width, height);

    // Selected region highlight background
    if (this.interactive) {
      ctx.fillStyle = 'rgba(56, 189, 248, 0.12)';
      ctx.fillRect(startX, 0, Math.max(1, endX - startX), height);
    }

    // Center line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();

    // Waveform bars
    const centerY = height / 2;
    for (let x = 0; x < width; x++) {
      const peak = this.peaks[x] || 0;
      const barHeight = Math.max(2, peak * (height * 0.85));
      const isSelected = x >= startX && x <= endX;

      ctx.fillStyle = isSelected ? '#38bdf8' : '#475569';
      ctx.fillRect(x, centerY - barHeight / 2, 1, barHeight);
    }

    // Draw handles & boundaries if interactive
    if (this.interactive) {
      // Start Marker
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(startX, 0);
      ctx.lineTo(startX, height);
      ctx.stroke();

      // Start Handle Flag
      ctx.fillStyle = '#22c55e';
      ctx.beginPath();
      ctx.rect(startX - 2, 0, 14, 18);
      ctx.roundRect ? ctx.roundRect(startX - 2, 0, 14, 18, 4) : ctx.rect(startX - 2, 0, 14, 18);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('S', startX + 5, 13);

      // End Marker
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(endX, 0);
      ctx.lineTo(endX, height);
      ctx.stroke();

      // End Handle Flag
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.rect(endX - 12, 0, 14, 18);
      ctx.roundRect ? ctx.roundRect(endX - 12, 0, 14, 18, 4) : ctx.rect(endX - 12, 0, 14, 18);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('E', endX - 5, 13);
    }

    // Playhead cursor
    if (this.currentTime >= 0 && this.currentTime <= duration) {
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(playX, 0);
      ctx.lineTo(playX, height);
      ctx.stroke();

      ctx.fillStyle = '#f59e0b';
      ctx.beginPath();
      ctx.arc(playX, height - 6, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  initEvents() {
    if (!this.interactive) return;

    const getXPos = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const scaleX = this.canvas.width / rect.width;
      return (e.clientX - rect.left) * scaleX;
    };

    const handlePointerDown = (e) => {
      if (!this.buffer) return;
      const x = getXPos(e);
      const width = this.canvas.width;
      const duration = this.buffer.duration;
      const startX = (this.startTime / duration) * width;
      const endX = (this.endTime / duration) * width;

      const tolerance = 15;
      if (Math.abs(x - startX) <= tolerance) {
        this.activeHandle = 'start';
      } else if (Math.abs(x - endX) <= tolerance) {
        this.activeHandle = 'end';
      } else {
        // Direct seek or set start/end
        const clickTime = (x / width) * duration;
        this.onSeek(clickTime);
      }
    };

    const handlePointerMove = (e) => {
      if (!this.buffer) return;
      const x = getXPos(e);
      const width = this.canvas.width;
      const duration = this.buffer.duration;
      const time = Math.max(0, Math.min(duration, (x / width) * duration));

      if (this.activeHandle === 'start') {
        this.startTime = Math.min(time, this.endTime);
        this.draw();
        this.onRegionChange(this.startTime, this.endTime);
      } else if (this.activeHandle === 'end') {
        this.endTime = Math.max(time, this.startTime);
        this.draw();
        this.onRegionChange(this.startTime, this.endTime);
      } else {
        // Change cursor hover
        const startX = (this.startTime / duration) * width;
        const endX = (this.endTime / duration) * width;
        if (Math.abs(x - startX) <= 15 || Math.abs(x - endX) <= 15) {
          this.canvas.style.cursor = 'ew-resize';
        } else {
          this.canvas.style.cursor = 'pointer';
        }
      }
    };

    const handlePointerUp = () => {
      this.activeHandle = null;
    };

    this.canvas.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('mousemove', handlePointerMove);
    window.addEventListener('mouseup', handlePointerUp);

    // Touch events for mobile/tablet
    this.canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length > 0) handlePointerDown(e.touches[0]);
    });
    window.addEventListener('touchmove', (e) => {
      if (e.touches.length > 0) handlePointerMove(e.touches[0]);
    });
    window.addEventListener('touchend', handlePointerUp);
  }
}
