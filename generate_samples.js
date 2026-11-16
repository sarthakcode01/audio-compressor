// Generates test wav files (pure JS, zero dependencies)
import fs from 'node:fs';

function generateWav(filename, durationSec, freq, type = 'sine') {
  const sampleRate = 44100;
  const numChannels = 1;
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const numSamples = Math.floor(durationSec * sampleRate);
  const dataByteCount = numSamples * blockAlign;
  const buffer = Buffer.alloc(44 + dataByteCount);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataByteCount, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // Subchunk1Size
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * blockAlign, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitDepth, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataByteCount, 40);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    let sample = 0;
    if (type === 'sine') {
      sample = Math.sin(2 * Math.PI * freq * t) * Math.exp(-t / (durationSec * 0.7)); // decaying chime
    } else if (type === 'melody') {
      const melodyFreq = freq * (1 + 0.3 * Math.sin(4 * Math.PI * t));
      sample = 0.6 * Math.sin(2 * Math.PI * melodyFreq * t) + 0.3 * Math.sin(4 * Math.PI * melodyFreq * t);
    }
    const intSample = Math.max(-32768, Math.min(32767, Math.floor(sample * 30000)));
    buffer.writeInt16LE(intSample, offset);
    offset += 2;
  }

  fs.writeFileSync(filename, buffer);
  console.log(`Generated ${filename} (${durationSec}s, ${freq}Hz)`);
}

generateWav('sample_chime.wav', 4.0, 440, 'sine');
generateWav('sample_melody.wav', 5.0, 523.25, 'melody');
