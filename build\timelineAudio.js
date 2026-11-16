import { audioBufferToWav, getAudioContext } from './audioEngine.js';

let activeSources = [];
let activeMediaElements = [];
let animFrameId = null;
let isPlaying = false;
let playStartTime = 0;
let playStartPlayhead = 0;

/**
 * Starts multi-clip playback from current playhead position
 */
export function playTimeline(timeline, onTimeUpdate, onEnded) {
  stopTimelinePlayback();

  if (timeline.clips.length === 0) return;
  const ctx = getAudioContext();
  const totalDuration = timeline.getTotalDuration();

  if (timeline.playheadTime >= totalDuration) {
    timeline.playheadTime = 0;
  }

  const currentPlayhead = timeline.playheadTime;
  isPlaying = true;
  playStartTime = ctx.currentTime;
  playStartPlayhead = currentPlayhead;

  // 1. Schedule AudioBuffer clips
  for (const clip of timeline.clips) {
    const clipEnd = clip.startOnTimeline + clip.duration;
    if (clipEnd <= currentPlayhead) continue;

    if (clip.buffer) {
      const source = ctx.createBufferSource();
      source.buffer = clip.buffer;
      const gainNode = ctx.createGain();

      let startDelay = 0;
      let sourceOffset = clip.offsetInSource;
      let playDuration = clip.duration;

      if (clip.startOnTimeline >= currentPlayhead) {
        startDelay = clip.startOnTimeline - currentPlayhead;
        sourceOffset = clip.offsetInSource;
        playDuration = clip.duration;
      } else {
        const elapsed = currentPlayhead - clip.startOnTimeline;
        startDelay = 0;
        sourceOffset = clip.offsetInSource + elapsed;
        playDuration = clip.duration - elapsed;
      }

      const scheduledStartTime = ctx.currentTime + startDelay;
      const scheduledEndTime = scheduledStartTime + playDuration;

      const targetVolume = clip.volume !== undefined ? clip.volume : 1.0;
      gainNode.gain.setValueAtTime(targetVolume, scheduledStartTime);

      if (clip.fadeIn > 0 && startDelay === 0 && (currentPlayhead - clip.startOnTimeline) < clip.fadeIn) {
        gainNode.gain.setValueAtTime(0, scheduledStartTime);
        gainNode.gain.linearRampToValueAtTime(targetVolume, scheduledStartTime + (clip.fadeIn - (currentPlayhead - clip.startOnTimeline)));
      } else if (clip.fadeIn > 0 && startDelay > 0) {
        gainNode.gain.setValueAtTime(0, scheduledStartTime);
        gainNode.gain.linearRampToValueAtTime(targetVolume, scheduledStartTime + clip.fadeIn);
      }

      if (clip.fadeOut > 0) {
        const fadeOutStart = scheduledEndTime - clip.fadeOut;
        if (fadeOutStart > scheduledStartTime) {
          gainNode.gain.setValueAtTime(targetVolume, fadeOutStart);
          gainNode.gain.linearRampToValueAtTime(0, scheduledEndTime);
        }
      }

      source.connect(gainNode);
      gainNode.connect(ctx.destination);

      source.start(scheduledStartTime, sourceOffset, playDuration);
      activeSources.push(source);
    } else if (clip.mediaAsset && clip.mediaAsset.audioElement) {
      activeMediaElements.push(clip.mediaAsset.audioElement);
    }
  }

  // 2. Animation & MediaElement sync loop
  function updateProgress() {
    if (!isPlaying) return;
    const elapsed = ctx.currentTime - playStartTime;
    const newPlayhead = playStartPlayhead + elapsed;

    if (newPlayhead >= totalDuration) {
      timeline.playheadTime = totalDuration;
      onTimeUpdate(totalDuration);
      stopTimelinePlayback();
      if (onEnded) onEnded();
      return;
    }

    timeline.playheadTime = newPlayhead;
    onTimeUpdate(newPlayhead);

    // Sync streaming media element clips
    for (const clip of timeline.clips) {
      if (clip.mediaAsset && clip.mediaAsset.audioElement) {
        const audioEl = clip.mediaAsset.audioElement;
        const clipStart = clip.startOnTimeline;
        const clipEnd = clipStart + clip.duration;

        if (newPlayhead >= clipStart && newPlayhead < clipEnd) {
          const desiredPos = clip.offsetInSource + (newPlayhead - clipStart);
          if (Math.abs(audioEl.currentTime - desiredPos) > 0.3) {
            audioEl.currentTime = desiredPos;
          }
          audioEl.volume = Math.max(0, Math.min(1.0, clip.volume !== undefined ? clip.volume : 1.0));
          if (audioEl.paused) {
            audioEl.play().catch(() => {});
          }
        } else {
          if (!audioEl.paused) {
            audioEl.pause();
          }
        }
      }
    }

    animFrameId = requestAnimationFrame(updateProgress);
  }

  animFrameId = requestAnimationFrame(updateProgress);
}

/**
 * Syncs streaming audio elements when user scrubs or seeks to a new time
 */
export function syncTimelineSeek(timeline, time) {
  for (const clip of timeline.clips) {
    if (clip.mediaAsset && clip.mediaAsset.audioElement) {
      const audioEl = clip.mediaAsset.audioElement;
      if (time >= clip.startOnTimeline && time < clip.startOnTimeline + clip.duration) {
        audioEl.currentTime = clip.offsetInSource + (time - clip.startOnTimeline);
      } else {
        if (!audioEl.paused) audioEl.pause();
      }
    }
  }
}

/**
 * Stops playback immediately and clears animation
 */
export function stopTimelinePlayback() {
  isPlaying = false;
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
  for (const src of activeSources) {
    try {
      src.stop();
    } catch {}
    try {
      src.disconnect();
    } catch {}
  }
  activeSources = [];

  for (const el of activeMediaElements) {
    try {
      el.pause();
    } catch {}
  }
  activeMediaElements = [];
}

export function getIsPlaying() {
  return isPlaying;
}

/**
 * Renders all clips on the timeline into a continuous master WAV Blob
 * @param {TimelineModel} timeline 
 * @returns {Promise<Blob>}
 */
export async function renderMasterWav(timeline) {
  if (timeline.clips.length === 0) {
    throw new Error('Timeline is empty');
  }

  const sampleRate = 44100;
  const numChannels = 2; // Stereo master
  const totalDuration = Math.max(timeline.getTotalDuration(), 0.5);

  // Check if any clip is a streaming media element
  const hasStreamClip = timeline.clips.some(c => !c.buffer && c.mediaAsset);

  if (!hasStreamClip) {
    // Pure AudioBuffer rendering via OfflineAudioContext
    const totalSamples = Math.ceil(totalDuration * sampleRate);
    const offlineCtx = new OfflineAudioContext(numChannels, totalSamples, sampleRate);

    for (const clip of timeline.clips) {
      const source = offlineCtx.createBufferSource();
      source.buffer = clip.buffer;

      const gainNode = offlineCtx.createGain();
      const targetVolume = clip.volume !== undefined ? clip.volume : 1.0;
      const startTime = clip.startOnTimeline;
      const endTime = startTime + clip.duration;

      gainNode.gain.setValueAtTime(targetVolume, startTime);

      if (clip.fadeIn > 0) {
        gainNode.gain.setValueAtTime(0, startTime);
        gainNode.gain.linearRampToValueAtTime(targetVolume, startTime + clip.fadeIn);
      }

      if (clip.fadeOut > 0) {
        const fadeOutStart = Math.max(startTime, endTime - clip.fadeOut);
        gainNode.gain.setValueAtTime(targetVolume, fadeOutStart);
        gainNode.gain.linearRampToValueAtTime(0, endTime);
      }

      source.connect(gainNode);
      gainNode.connect(offlineCtx.destination);

      source.start(startTime, clip.offsetInSource, clip.duration);
    }

    const renderedBuffer = await offlineCtx.startRendering();
    return audioBufferToWav(renderedBuffer);
  } else {
    // Mixed / MediaStream rendering via Web Audio MediaStreamDestination & MediaRecorder
    const ctx = getAudioContext();
    const dest = ctx.createMediaStreamDestination();
    const recorder = new MediaRecorder(dest.stream);
    const chunks = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    return new Promise((resolve, reject) => {
      recorder.onstop = () => {
        const recordedBlob = new Blob(chunks, { type: 'audio/webm' });
        resolve(recordedBlob);
      };

      recorder.start();
      // Play timeline through destination
      playTimeline(timeline, () => {}, () => {
        recorder.stop();
      });
    });
  }
}
