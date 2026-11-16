// Build script for Vercel, static hosting, and local development
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FRONTEND_FILES = [
  'index.html',
  'style.css',
  'main.js',
  'audioEngine.js',
  'timelineModel.js',
  'timelineView.js',
  'timelineAudio.js',
  'waveform.js',
  'sample_chime.wav',
  'sample_melody.wav'
];

const TARGET_DIRS = ['dist', 'public', 'build', 'src'];

console.log('=== Building Frontend Assets ===');

// Create a valid favicon.ico content (PNG or SVG)
const SVG_FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="#0284c7"/><text y=".75em" x="22" font-size="60">🎵</text></svg>`;

for (const targetDir of TARGET_DIRS) {
  const targetPath = path.join(__dirname, targetDir);
  if (!fs.existsSync(targetPath)) {
    fs.mkdirSync(targetPath, { recursive: true });
  }

  for (const file of FRONTEND_FILES) {
    const srcPath = path.join(__dirname, file);
    if (fs.existsSync(srcPath)) {
      const destPath = path.join(targetPath, file);
      fs.copyFileSync(srcPath, destPath);
    }
  }

  // Also place favicon in each target dir
  fs.writeFileSync(path.join(targetPath, 'favicon.ico'), SVG_FAVICON, 'utf8');
  fs.writeFileSync(path.join(targetPath, 'favicon.svg'), SVG_FAVICON, 'utf8');
  console.log(`✓ Populated ${targetDir}/ with frontend assets`);
}

// Also ensure root has favicon
fs.writeFileSync(path.join(__dirname, 'favicon.ico'), SVG_FAVICON, 'utf8');
fs.writeFileSync(path.join(__dirname, 'favicon.svg'), SVG_FAVICON, 'utf8');

console.log('=== Build Successful: dist/, public/, build/, src/, and root are in sync! ===');
