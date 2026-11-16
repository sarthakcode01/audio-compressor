/**
 * Timeline Data Model for Multi-Clip NLE Audio Editing
 */

let nextClipId = 1;

export class TimelineModel {
  constructor() {
    this.clips = [];
    this.playheadTime = 0; // Current time in seconds
    this.selectedClipId = null;
    this.zoom = 80; // Pixels per second
    this.snapThreshold = 0.15; // Snap within 0.15s
    this.history = []; // Undo stack
    this.colorPalette = [
      '#0284c7', // Sky Blue
      '#7c3aed', // Purple
      '#059669', // Emerald
      '#d97706', // Amber
      '#db2777', // Pink
      '#4f46e5'  // Indigo
    ];
  }

  saveSnapshot() {
    // Keep max 20 snapshots
    const snapshot = {
      clips: this.clips.map(c => ({ ...c })),
      playheadTime: this.playheadTime,
      selectedClipId: this.selectedClipId
    };
    this.history.push(snapshot);
    if (this.history.length > 20) {
      this.history.shift();
    }
  }

  undo() {
    if (this.history.length === 0) return false;
    const snapshot = this.history.pop();
    this.clips = snapshot.clips;
    this.playheadTime = snapshot.playheadTime;
    this.selectedClipId = snapshot.selectedClipId;
    return true;
  }

  /**
   * Adds an audio buffer or streaming media asset as a new clip onto the timeline
   * @param {string} name 
   * @param {AudioBuffer|Object} bufferOrAsset 
   */
  addClip(name, bufferOrAsset) {
    this.saveSnapshot();
    // Default place at end of existing clips
    const lastClip = this.clips[this.clips.length - 1];
    const startOnTimeline = lastClip ? (lastClip.startOnTimeline + lastClip.duration) : 0;
    
    const isStream = !!bufferOrAsset.isMediaStream;
    const duration = bufferOrAsset.duration || 60;

    const clip = {
      id: `clip_${nextClipId++}`,
      name: name.replace(/\.[^/.]+$/, ''),
      buffer: isStream ? null : bufferOrAsset,
      mediaAsset: isStream ? bufferOrAsset : null,
      startOnTimeline: Math.max(0, startOnTimeline),
      offsetInSource: 0,
      duration: duration,
      volume: 1.0,
      fadeIn: 0.0,
      fadeOut: 0.0,
      color: this.colorPalette[(nextClipId - 1) % this.colorPalette.length]
    };

    this.clips.push(clip);
    this.selectedClipId = clip.id;

    // Automatically adapt zoom to fit comfortably on timeline
    if (this.clips.length === 1) {
      if (duration > 3600) {
        this.zoom = 2; // 2 px/sec for long audiobooks (> 1hr)
      } else if (duration > 600) {
        this.zoom = 8; // 8 px/sec for 10-60 min
      } else {
        this.zoom = 50; // 50 px/sec for short tracks (< 10 min)
      }
    }

    return clip;
  }

  /**
   * Gets total duration of the timeline in seconds
   */
  getTotalDuration() {
    if (this.clips.length === 0) return 0;
    return Math.max(...this.clips.map(c => c.startOnTimeline + c.duration), 0);
  }

  getClipById(id) {
    return this.clips.find(c => c.id === id) || null;
  }

  getSelectedClip() {
    return this.getClipById(this.selectedClipId);
  }

  getClipAtTime(time) {
    return this.clips.find(c => time >= c.startOnTimeline && time < (c.startOnTimeline + c.duration)) || null;
  }

  /**
   * Splits the clip under the playhead into two separate clips (Left & Right)
   */
  splitAtPlayhead(splitTime = this.playheadTime) {
    // Target either the selected clip or the clip intersecting splitTime
    let target = this.getSelectedClip();
    if (!target || splitTime <= target.startOnTimeline || splitTime >= (target.startOnTimeline + target.duration)) {
      target = this.getClipAtTime(splitTime);
    }
    if (!target) return null;

    // Minimum split margin of 0.05 seconds
    if (splitTime <= target.startOnTimeline + 0.05 || splitTime >= (target.startOnTimeline + target.duration - 0.05)) {
      return null;
    }

    this.saveSnapshot();

    const targetIdx = this.clips.indexOf(target);
    const leftDuration = splitTime - target.startOnTimeline;
    const rightDuration = target.duration - leftDuration;

    // Left Clip retains the starting slice
    const leftClip = {
      ...target,
      id: `clip_${nextClipId++}`,
      name: `${target.name} [Part 1]`,
      duration: leftDuration,
      fadeOut: 0
    };

    // Right Clip starts from the split point
    const rightClip = {
      ...target,
      id: `clip_${nextClipId++}`,
      name: `${target.name} [Part 2]`,
      startOnTimeline: splitTime,
      offsetInSource: target.offsetInSource + leftDuration,
      duration: rightDuration,
      fadeIn: 0
    };

    // Replace target clip with the two new parts
    this.clips.splice(targetIdx, 1, leftClip, rightClip);
    this.selectedClipId = rightClip.id;

    return { leftClip, rightClip };
  }

  /**
   * Trims from clip start up to playhead (Trim Left)
   */
  trimLeftAtPlayhead(trimTime = this.playheadTime) {
    let target = this.getSelectedClip();
    if (!target || trimTime <= target.startOnTimeline || trimTime >= (target.startOnTimeline + target.duration)) {
      target = this.getClipAtTime(trimTime);
    }
    if (!target) return false;

    const cutAmount = trimTime - target.startOnTimeline;
    if (cutAmount <= 0.05 || cutAmount >= target.duration - 0.05) return false;

    this.saveSnapshot();

    target.offsetInSource += cutAmount;
    target.duration -= cutAmount;
    target.startOnTimeline = trimTime;

    return true;
  }

  /**
   * Trims from playhead to clip end (Trim Right)
   */
  trimRightAtPlayhead(trimTime = this.playheadTime) {
    let target = this.getSelectedClip();
    if (!target || trimTime <= target.startOnTimeline || trimTime >= (target.startOnTimeline + target.duration)) {
      target = this.getClipAtTime(trimTime);
    }
    if (!target) return false;

    const newDuration = trimTime - target.startOnTimeline;
    if (newDuration <= 0.05 || newDuration >= target.duration - 0.05) return false;

    this.saveSnapshot();

    target.duration = newDuration;

    return true;
  }

  /**
   * Deletes a clip from the timeline
   * @param {string} clipId 
   * @param {boolean} ripple - if true, shifts subsequent clips left
   */
  deleteClip(clipId = this.selectedClipId, ripple = true) {
    if (!clipId) return false;
    const idx = this.clips.findIndex(c => c.id === clipId);
    if (idx === -1) return false;

    this.saveSnapshot();

    const [deleted] = this.clips.splice(idx, 1);

    if (ripple) {
      const shiftAmount = deleted.duration;
      for (let i = idx; i < this.clips.length; i++) {
        this.clips[i].startOnTimeline = Math.max(0, this.clips[i].startOnTimeline - shiftAmount);
      }
    }

    // Select next available clip
    if (this.clips.length > 0) {
      this.selectedClipId = this.clips[Math.min(idx, this.clips.length - 1)].id;
    } else {
      this.selectedClipId = null;
    }

    return true;
  }

  /**
   * Moves a clip to a new start position on the timeline
   */
  moveClip(clipId, newStartTimeline) {
    const clip = this.getClipById(clipId);
    if (!clip) return;

    let targetStart = Math.max(0, newStartTimeline);

    // Magnetic snap to neighboring clips or playhead
    const snapPoints = [0, this.playheadTime];
    for (const c of this.clips) {
      if (c.id !== clipId) {
        snapPoints.push(c.startOnTimeline);
        snapPoints.push(c.startOnTimeline + c.duration);
      }
    }

    for (const pt of snapPoints) {
      // Snap clip start to point
      if (Math.abs(targetStart - pt) < this.snapThreshold) {
        targetStart = pt;
        break;
      }
      // Snap clip end to point
      if (Math.abs((targetStart + clip.duration) - pt) < this.snapThreshold) {
        targetStart = pt - clip.duration;
        break;
      }
    }

    clip.startOnTimeline = Math.max(0, targetStart);
    // Keep clips sorted by timeline position
    this.clips.sort((a, b) => a.startOnTimeline - b.startOnTimeline);
  }

  /**
   * Trims clip start or end edge interactively
   */
  adjustClipEdge(clipId, edge, deltaSec) {
    const clip = this.getClipById(clipId);
    if (!clip) return;

    const totalSourceDur = clip.buffer ? clip.buffer.duration : (clip.mediaAsset ? clip.mediaAsset.duration : clip.duration);
    if (edge === 'start') {
      const maxDelta = clip.duration - 0.1;
      const actualDelta = Math.max(-clip.offsetInSource, Math.min(deltaSec, maxDelta));
      clip.offsetInSource += actualDelta;
      clip.duration -= actualDelta;
      clip.startOnTimeline += actualDelta;
    } else if (edge === 'end') {
      const maxSourceRemaining = totalSourceDur - (clip.offsetInSource + clip.duration);
      const actualDelta = Math.max(-clip.duration + 0.1, Math.min(deltaSec, maxSourceRemaining));
      clip.duration += actualDelta;
    }
  }

  setClipVolume(clipId, volume) {
    const clip = this.getClipById(clipId);
    if (clip) clip.volume = Math.max(0, Math.min(volume, 2.0));
  }

  setClipFades(clipId, fadeIn, fadeOut) {
    const clip = this.getClipById(clipId);
    if (clip) {
      clip.fadeIn = Math.max(0, Math.min(fadeIn, clip.duration / 2));
      clip.fadeOut = Math.max(0, Math.min(fadeOut, clip.duration / 2));
    }
  }
}
