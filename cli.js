#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

// Pure Node.js 16-bit PCM WAV Parser and Writer
function parseWav(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Not a valid RIFF/WAVE file');
  }

  let offset = 12;
  let fmt = null;
  let dataOffset = 0;
  let dataSize = 0;

  while (offset < buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);

    if (chunkId === 'fmt ') {
      fmt = {
        audioFormat: buffer.readUInt16LE(offset + 8),
        numChannels: buffer.readUInt16LE(offset + 10),
        sampleRate: buffer.readUInt32LE(offset + 12),
        byteRate: buffer.readUInt32LE(offset + 16),
        blockAlign: buffer.readUInt16LE(offset + 20),
        bitsPerSample: buffer.readUInt16LE(offset + 22)
      };
    } else if (chunkId === 'data') {
      dataOffset = offset + 8;
      dataSize = chunkSize;
      break;
    }
    offset += 8 + chunkSize;
  }

  if (!fmt || !dataOffset) {
    throw new Error('Missing fmt or data chunk');
  }

  if (fmt.bitsPerSample !== 16) {
    throw new Error(`Only 16-bit PCM WAV is supported in this basic CLI tool (file is ${fmt.bitsPerSample}-bit)`);
  }

  const numSamples = Math.floor(dataSize / fmt.blockAlign);
  const duration = numSamples / fmt.sampleRate;

  return { fmt, dataOffset, dataSize, numSamples, duration, rawData: buffer.subarray(dataOffset, dataOffset + dataSize) };
}

function createWavBuffer(fmt, pcmData) {
  const dataByteCount = pcmData.length;
  const buffer = Buffer.alloc(44 + dataByteCount);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataByteCount, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(fmt.numChannels, 22);
  buffer.writeUInt32LE(fmt.sampleRate, 24);
  buffer.writeUInt32LE(fmt.sampleRate * fmt.blockAlign, 28);
  buffer.writeUInt16LE(fmt.blockAlign, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataByteCount, 40);

  pcmData.copy(buffer, 44);
  return buffer;
}

// CLI Command Handlers
const args = process.argv.slice(2);
const command = args[0];

function printUsage() {
  console.log(`
=========================================
      Audio CLI (Zero-Dependency)
=========================================
Commands:
  1. Cut / Trim:
     node cli.js cut <input.wav> <output.wav> <startSec> <endSec>
     Example: node cli.js cut input.wav trimmed.wav 1.0 3.5

  2. Merge Two Files:
     node cli.js merge <file1.wav> <file2.wav> <output.wav> [gapSec]
     Example: node cli.js merge intro.wav song.wav merged.wav 1.0

  3. Volume Adjust:
     node cli.js volume <input.wav> <output.wav> <gainFactor>
     Example: node cli.js volume input.wav louder.wav 1.5

  4. Reverse Audio:
     node cli.js reverse <input.wav> <output.wav>
     Example: node cli.js reverse input.wav reversed.wav

  5. Info:
     node cli.js info <input.wav>
`);
}

if (!command || command === '--help' || command === '-h') {
  printUsage();
  process.exit(0);
}

try {
  if (command === 'info') {
    const file = args[1];
    if (!file) throw new Error('Specify file to inspect: node cli.js info <file.wav>');
    const buf = fs.readFileSync(file);
    const parsed = parseWav(buf);
    console.log(`\nFile: ${path.basename(file)}`);
    console.log(`Duration: ${parsed.duration.toFixed(2)}s`);
    console.log(`Channels: ${parsed.fmt.numChannels} (${parsed.fmt.numChannels === 1 ? 'Mono' : 'Stereo'})`);
    console.log(`Sample Rate: ${parsed.fmt.sampleRate} Hz`);
    console.log(`Bit Depth: ${parsed.fmt.bitsPerSample}-bit\n`);
  }

  else if (command === 'cut') {
    const [_, inputFile, outputFile, startStr, endStr] = args;
    if (!inputFile || !outputFile || startStr === undefined || endStr === undefined) {
      throw new Error('Usage: node cli.js cut <input.wav> <output.wav> <startSec> <endSec>');
    }
    const startSec = Math.max(0, parseFloat(startStr));
    const endSec = parseFloat(endStr);
    const buf = fs.readFileSync(inputFile);
    const wav = parseWav(buf);

    if (endSec <= startSec) throw new Error('endSec must be greater than startSec');

    const startByte = Math.min(wav.dataSize, Math.floor(startSec * wav.fmt.sampleRate) * wav.fmt.blockAlign);
    const endByte = Math.min(wav.dataSize, Math.floor(endSec * wav.fmt.sampleRate) * wav.fmt.blockAlign);
    const slicedPcm = wav.rawData.subarray(startByte, endByte);

    const outBuf = createWavBuffer(wav.fmt, slicedPcm);
    fs.writeFileSync(outputFile, outBuf);
    console.log(`[Success] Cut [${startSec}s -> ${endSec}s] saved to ${outputFile} (Duration: ${(endByte - startByte) / wav.fmt.sampleRate / wav.fmt.blockAlign}s)`);
  }

  else if (command === 'merge') {
    const [_, file1, file2, outputFile, gapStr] = args;
    if (!file1 || !file2 || !outputFile) {
      throw new Error('Usage: node cli.js merge <file1.wav> <file2.wav> <output.wav> [gapSec]');
    }
    const gapSec = gapStr ? Math.max(0, parseFloat(gapStr)) : 0;
    const wav1 = parseWav(fs.readFileSync(file1));
    const wav2 = parseWav(fs.readFileSync(file2));

    if (wav1.fmt.sampleRate !== wav2.fmt.sampleRate || wav1.fmt.numChannels !== wav2.fmt.numChannels) {
      console.warn(`[Warning] Files have different format/rates (${wav1.fmt.sampleRate}Hz/${wav1.fmt.numChannels}ch vs ${wav2.fmt.sampleRate}Hz/${wav2.fmt.numChannels}ch). Using ${wav1.fmt.sampleRate}Hz/${wav1.fmt.numChannels}ch format.`);
    }

    const gapBytes = Math.floor(gapSec * wav1.fmt.sampleRate) * wav1.fmt.blockAlign;
    const gapBuffer = Buffer.alloc(gapBytes); // zero-filled silence
    const mergedPcm = Buffer.concat([wav1.rawData, gapBuffer, wav2.rawData]);

    const outBuf = createWavBuffer(wav1.fmt, mergedPcm);
    fs.writeFileSync(outputFile, outBuf);
    const totalDur = (wav1.duration + gapSec + wav2.duration).toFixed(2);
    console.log(`[Success] Merged ${file1} + ${gapSec}s gap + ${file2} -> ${outputFile} (Total Duration: ${totalDur}s)`);
  }

  else if (command === 'volume') {
    const [_, inputFile, outputFile, factorStr] = args;
    if (!inputFile || !outputFile || factorStr === undefined) {
      throw new Error('Usage: node cli.js volume <input.wav> <output.wav> <factor>');
    }
    const factor = parseFloat(factorStr);
    const wav = parseWav(fs.readFileSync(inputFile));
    const outputPcm = Buffer.alloc(wav.rawData.length);

    for (let i = 0; i < wav.rawData.length; i += 2) {
      let sample = wav.rawData.readInt16LE(i);
      sample = Math.max(-32768, Math.min(32767, Math.floor(sample * factor)));
      outputPcm.writeInt16LE(sample, i);
    }

    const outBuf = createWavBuffer(wav.fmt, outputPcm);
    fs.writeFileSync(outputFile, outBuf);
    console.log(`[Success] Adjusted volume by factor ${factor} -> ${outputFile}`);
  }

  else if (command === 'reverse') {
    const [_, inputFile, outputFile] = args;
    if (!inputFile || !outputFile) {
      throw new Error('Usage: node cli.js reverse <input.wav> <output.wav>');
    }
    const wav = parseWav(fs.readFileSync(inputFile));
    const outputPcm = Buffer.alloc(wav.rawData.length);
    const blockAlign = wav.fmt.blockAlign;
    const numBlocks = wav.rawData.length / blockAlign;

    for (let i = 0; i < numBlocks; i++) {
      const srcOffset = (numBlocks - 1 - i) * blockAlign;
      const dstOffset = i * blockAlign;
      wav.rawData.copy(outputPcm, dstOffset, srcOffset, srcOffset + blockAlign);
    }

    const outBuf = createWavBuffer(wav.fmt, outputPcm);
    fs.writeFileSync(outputFile, outBuf);
    console.log(`[Success] Reversed audio saved to ${outputFile}`);
  }

  else {
    console.error(`Unknown command: "${command}"`);
    printUsage();
  }
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
