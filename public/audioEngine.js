// Audio Engine for Web Audio processing: decode, slice, merge, effects, and WAV export

let audioCtxInstance = null;

export function getAudioContext() {
  if (!audioCtxInstance) {
    audioCtxInstance = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtxInstance.state === 'suspended') {
    audioCtxInstance.resume().catch(() => {});
  }
  return audioCtxInstance;
}

/**
 * Detects the real audio container format from magic bytes
 * @param {ArrayBuffer} arrayBuffer 
 * @returns {string} MIME type
 */
export function detectAudioMime(arrayBuffer) {
  if (!arrayBuffer || arrayBuffer.byteLength < 4) return 'audio/mpeg';
  const v = new DataView(arrayBuffer);
  const b0 = v.getUint8(0), b1 = v.getUint8(1), b2 = v.getUint8(2), b3 = v.getUint8(3);

  // 1A 45 DF A3 = EBML / WebM / Matroska (Opus / Vorbis)
  if (b0 === 0x1A && b1 === 0x45 && b2 === 0xDF && b3 === 0xA3) return 'audio/webm';
  // 4F 67 67 53 = OggS
  if (b0 === 0x4F && b1 === 0x67 && b2 === 0x67 && b3 === 0x53) return 'audio/ogg';
  // 52 49 46 46 = RIFF (WAV)
  if (b0 === 0x52 && b1 === 0x49 && b2 === 0x46 && b3 === 0x46) return 'audio/wav';
  // ftyp at offset 4 (M4A / MP4 / AAC)
  if (arrayBuffer.byteLength >= 8) {
    const b4 = v.getUint8(4), b5 = v.getUint8(5), b6 = v.getUint8(6), b7 = v.getUint8(7);
    if (b4 === 0x66 && b5 === 0x74 && b6 === 0x79 && b7 === 0x70) return 'audio/mp4';
  }
  return 'audio/mpeg';
}

/**
 * Parses WebM header in pure JS to extract duration in seconds
 * @param {ArrayBuffer} arrayBuffer 
 * @returns {number|null} duration in seconds
 */
export function getWebmDurationFromHeader(arrayBuffer) {
  try {
    const maxScan = Math.min(arrayBuffer.byteLength, 15000);
    const view = new DataView(arrayBuffer);
    const bytes = new Uint8Array(arrayBuffer, 0, maxScan);

    let timecodeScale = 1000000; // default 1ms

    // Search for TimecodeScale (0x2AD7B1)
    for (let i = 0; i < maxScan - 8; i++) {
      if (bytes[i] === 0x2A && bytes[i + 1] === 0xD7 && bytes[i + 2] === 0xB1) {
        const len = bytes[i + 3];
        if (len === 1) timecodeScale = bytes[i + 4];
        else if (len === 2) timecodeScale = view.getUint16(i + 4, false);
        else if (len === 4) timecodeScale = view.getUint32(i + 4, false);
        break;
      }
    }

    // Search for Duration element (0x4489)
    for (let i = 0; i < maxScan - 10; i++) {
      if (bytes[i] === 0x44 && bytes[i + 1] === 0x89) {
        const len = bytes[i + 2];
        let rawDur = 0;
        if (len === 0x84 || len === 4) {
          rawDur = view.getFloat32(i + 3, false);
        } else if (len === 0x88 || len === 8) {
          rawDur = view.getFloat64(i + 3, false);
        }
        if (rawDur > 0) {
          return (rawDur * timecodeScale) / 1e9;
        }
      }
    }
  } catch (e) {
    console.warn('WebM header parse error:', e);
  }
  return null;
}

/**
 * Generates an array of visual peaks for smooth waveform rendering
 * @param {number} count 
 * @returns {Float32Array}
 */
export function generateAdaptivePeaks(count = 1000) {
  const peaks = new Float32Array(count);
  let prev = 0.5;
  for (let i = 0; i < count; i++) {
    const t = i / count;
    // Natural dynamic voice/music distribution
    const macro = 0.4 + 0.35 * Math.sin(t * 18);
    const noise = (Math.random() - 0.5) * 0.4;
    prev = prev * 0.7 + (macro + noise) * 0.3;
    peaks[i] = Math.max(0.08, Math.min(0.95, prev));
  }
  return peaks;
}

/**
 * Fallback parser for WAV files with complex/non-standard chunk structures or metadata
 * @param {ArrayBuffer} arrayBuffer 
 * @param {AudioContext} ctx 
 * @returns {AudioBuffer|null}
 */
export function parseWavManually(arrayBuffer, ctx) {
  try {
    const view = new DataView(arrayBuffer);
    if (arrayBuffer.byteLength < 44) return null;

    const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
    const wave = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
    if (riff !== 'RIFF' || wave !== 'WAVE') return null;

    let offset = 12;
    let format = 1;
    let numChannels = 1;
    let sampleRate = 44100;
    let bitsPerSample = 16;
    let dataOffset = 0;
    let dataLength = 0;

    while (offset + 8 <= arrayBuffer.byteLength) {
      const chunkId = String.fromCharCode(
        view.getUint8(offset),
        view.getUint8(offset + 1),
        view.getUint8(offset + 2),
        view.getUint8(offset + 3)
      );
      const chunkSize = view.getUint32(offset + 4, true);

      if (chunkId === 'fmt ') {
        format = view.getUint16(offset + 8, true);
        numChannels = view.getUint16(offset + 10, true);
        sampleRate = view.getUint32(offset + 12, true);
        bitsPerSample = view.getUint16(offset + 22, true);
      } else if (chunkId === 'data') {
        dataOffset = offset + 8;
        dataLength = Math.min(chunkSize, arrayBuffer.byteLength - dataOffset);
        break;
      }

      offset += 8 + chunkSize + (chunkSize % 2);
    }

    if (!dataOffset || dataLength <= 0 || numChannels <= 0 || sampleRate <= 0) return null;

    const bytesPerSample = bitsPerSample / 8;
    const blockAlign = numChannels * bytesPerSample;
    const numSamples = Math.floor(dataLength / blockAlign);
    if (numSamples <= 0) return null;

    const audioBuf = ctx.createBuffer(numChannels, numSamples, sampleRate);
    const channels = [];
    for (let c = 0; c < numChannels; c++) {
      channels.push(audioBuf.getChannelData(c));
    }

    let bytePtr = dataOffset;

    if (format === 1 && bitsPerSample === 16) {
      for (let i = 0; i < numSamples; i++) {
        for (let c = 0; c < numChannels; c++) {
          const sampleInt = view.getInt16(bytePtr, true);
          channels[c][i] = sampleInt < 0 ? sampleInt / 32768.0 : sampleInt / 32767.0;
          bytePtr += 2;
        }
      }
    } else if (format === 1 && bitsPerSample === 24) {
      for (let i = 0; i < numSamples; i++) {
        for (let c = 0; c < numChannels; c++) {
          const b0 = view.getUint8(bytePtr);
          const b1 = view.getUint8(bytePtr + 1);
          const b2 = view.getUint8(bytePtr + 2);
          let sampleInt = (b2 << 16) | (b1 << 8) | b0;
          if (sampleInt & 0x800000) sampleInt |= ~0xFFFFFF;
          channels[c][i] = sampleInt / 8388608.0;
          bytePtr += 3;
        }
      }
    } else if (format === 3 && bitsPerSample === 32) {
      for (let i = 0; i < numSamples; i++) {
        for (let c = 0; c < numChannels; c++) {
          channels[c][i] = view.getFloat32(bytePtr, true);
          bytePtr += 4;
        }
      }
    } else if (format === 1 && bitsPerSample === 8) {
      for (let i = 0; i < numSamples; i++) {
        for (let c = 0; c < numChannels; c++) {
          const u = view.getUint8(bytePtr);
          channels[c][i] = (u - 128) / 128.0;
          bytePtr += 1;
        }
      }
    } else {
      return null;
    }

    return audioBuf;
  } catch (e) {
    console.warn('Manual WAV parsing failed:', e);
    return null;
  }
}

/**
 * Strips ID3v2 header if present (for MP3s)
 * @param {ArrayBuffer} arrayBuffer 
 * @returns {ArrayBuffer}
 */
export function stripId3Tag(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  if (bytes.length > 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    const size = ((bytes[6] & 0x7f) << 21) |
                 ((bytes[7] & 0x7f) << 14) |
                 ((bytes[8] & 0x7f) << 7) |
                 (bytes[9] & 0x7f);
    const offset = 10 + size;
    if (offset < arrayBuffer.byteLength) {
      return arrayBuffer.slice(offset);
    }
  }
  return arrayBuffer;
}

/**
 * Loads large files or WebM/Opus audiobooks via HTML5 MediaElement streaming
 * with zero memory explosion and instant seeking.
 * @param {ArrayBuffer} arrayBuffer 
 * @param {File} file 
 * @param {string} mimeType 
 * @returns {Promise<Object>}
 */
export async function loadMediaStreamAsset(arrayBuffer, file, mimeType) {
  const blob = new Blob([arrayBuffer], { type: mimeType });
  const blobUrl = URL.createObjectURL(blob);
  const audio = new Audio();
  audio.preload = 'metadata';
  audio.src = blobUrl;

  // Header duration fallback (essential for long WebM streams in Chrome)
  const headerDuration = (mimeType === 'audio/webm') ? getWebmDurationFromHeader(arrayBuffer) : null;

  return new Promise((resolve, reject) => {
    let resolved = false;

    const cleanup = () => {
      audio.removeEventListener('loadedmetadata', onLoaded);
      audio.removeEventListener('error', onError);
    };

    const finalize = (duration) => {
      if (resolved) return;
      resolved = true;
      cleanup();

      const finalDuration = (duration > 0 && isFinite(duration)) 
        ? duration 
        : (headerDuration && headerDuration > 0 ? headerDuration : 60);

      resolve({
        isMediaStream: true,
        name: file.name,
        duration: finalDuration,
        audioElement: audio,
        blob: blob,
        blobUrl: blobUrl,
        mimeType: mimeType,
        peaks: generateAdaptivePeaks(1200),
        sampleRate: 48000,
        numberOfChannels: 2
      });
    };

    const onLoaded = () => {
      if (audio.duration && isFinite(audio.duration)) {
        finalize(audio.duration);
      } else if (headerDuration && headerDuration > 0) {
        finalize(headerDuration);
      } else {
        // Try setting currentTime to force duration resolution
        audio.currentTime = 1e6;
        audio.addEventListener('seeked', () => {
          finalize(audio.duration || headerDuration || 60);
        }, { once: true });
      }
    };

    const onError = (e) => {
      if (headerDuration && headerDuration > 0) {
        finalize(headerDuration);
      } else {
        cleanup();
        reject(new Error(`Failed to load audio asset "${file.name}"`));
      }
    };

    audio.addEventListener('loadedmetadata', onLoaded);
    audio.addEventListener('error', onError);

    // Timeout safety net: if metadata is slow, check header
    setTimeout(() => {
      if (!resolved) {
        if (headerDuration && headerDuration > 0) {
          finalize(headerDuration);
        } else if (audio.duration && isFinite(audio.duration)) {
          finalize(audio.duration);
        } else {
          finalize(60);
        }
      }
    }, 2500);
  });
}

/**
 * Decodes an uploaded audio File into an AudioBuffer or MediaStreamAsset
 * @param {File} file 
 * @returns {Promise<AudioBuffer|Object>}
 */
export async function decodeAudioFile(file) {
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') {
    await ctx.resume().catch(() => {});
  }

  // Read file as ArrayBuffer using FileReader
  const arrayBuffer = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed to read file from disk'));
    reader.readAsArrayBuffer(file);
  });

  const mimeType = detectAudioMime(arrayBuffer);

  // Large audio file check: files > 40 MB (e.g. 100MB+ audiobooks) or long WebM streams
  // Chrome's AudioContext.decodeAudioData will crash with EncodingError on huge allocations.
  if (arrayBuffer.byteLength > 40 * 1024 * 1024 || mimeType === 'audio/webm') {
    console.log(`Loading large / streaming audio file "${file.name}" (${(arrayBuffer.byteLength / (1024*1024)).toFixed(1)} MB, ${mimeType})...`);
    try {
      const mediaAsset = await loadMediaStreamAsset(arrayBuffer, file, mimeType);
      return mediaAsset;
    } catch (streamErr) {
      console.warn('Streaming load error, attempting native decode:', streamErr);
    }
  }

  // Attempt 1: Standard native decodeAudioData
  try {
    const bufferCopy = arrayBuffer.slice(0);
    const decoded = await new Promise((resolve, reject) => {
      ctx.decodeAudioData(bufferCopy, resolve, reject);
    });
    return decoded;
  } catch (nativeErr) {
    console.warn(`Standard decodeAudioData failed for "${file.name}", attempting fallbacks...`, nativeErr);

    // Attempt 2: Manual WAV Parser fallback
    const manualWav = parseWavManually(arrayBuffer, ctx);
    if (manualWav) {
      return manualWav;
    }

    // Attempt 3: ID3 Tag Stripper fallback (for MP3s)
    try {
      const stripped = stripId3Tag(arrayBuffer);
      if (stripped !== arrayBuffer) {
        const bufferCopy = stripped.slice(0);
        return await new Promise((resolve, reject) => {
          ctx.decodeAudioData(bufferCopy, resolve, reject);
        });
      }
    } catch (tagErr) {
      console.warn('ID3 stripped decoding failed:', tagErr);
    }

    // Attempt 4: Streaming MediaAsset fallback
    try {
      return await loadMediaStreamAsset(arrayBuffer, file, mimeType);
    } catch (finalErr) {
      console.error('All decode paths exhausted for:', file.name, finalErr);
    }

    throw new Error(`Unable to decode audio data for "${file.name}". Please ensure the file is a valid audio format.`);
  }
}

/**
 * Encodes an AudioBuffer into a 16-bit PCM WAV Blob
 * @param {AudioBuffer} buffer 
 * @returns {Blob}
 */
export function audioBufferToWav(buffer) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;

  const numSamples = buffer.length;
  const dataByteCount = numSamples * blockAlign;
  const wavBuffer = new ArrayBuffer(44 + dataByteCount);
  const view = new DataView(wavBuffer);

  const writeString = (offset, string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataByteCount, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(36, 'data');
  view.setUint32(40, dataByteCount, true);

  let offset = 44;
  const channelData = [];
  for (let c = 0; c < numChannels; c++) {
    channelData.push(buffer.getChannelData(c));
  }

  for (let i = 0; i < numSamples; i++) {
    for (let c = 0; c < numChannels; c++) {
      let sample = channelData[c][i];
      sample = Math.max(-1, Math.min(1, sample));
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }

  return new Blob([wavBuffer], { type: 'audio/wav' });
}

/**
 * Formats seconds into mm:ss.ms
 * @param {number} sec 
 * @returns {string}
 */
export function formatTime(sec) {
  if (isNaN(sec) || sec < 0) sec = 0;
  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const seconds = Math.floor(sec % 60);
  const millis = Math.floor((sec % 1) * 100);

  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  const ms = String(millis).padStart(2, '0');

  if (hours > 0) {
    const hh = String(hours).padStart(2, '0');
    return `${hh}:${mm}:${ss}.${ms}`;
  }
  return `${mm}:${ss}.${ms}`;
}
