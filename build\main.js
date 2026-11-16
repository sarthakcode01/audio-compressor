import { decodeAudioFile, formatTime } from './audioEngine.js';
import { TimelineModel } from './timelineModel.js';
import { TimelineView } from './timelineView.js';
import { playTimeline, stopTimelinePlayback, getIsPlaying, renderMasterWav, syncTimelineSeek } from './timelineAudio.js';

// --- State ---
const timeline = new TimelineModel();
let timelineView = null;

// --- DOM Elements ---
const timecodeCurrent = document.getElementById('timecode-current');
const timecodeTotal = document.getElementById('timecode-total');
const exportMasterBtn = document.getElementById('export-master-btn');

const addAudioBtn = document.getElementById('add-audio-btn');
const addAudioInput = document.getElementById('add-audio-input');

const btnJumpStart = document.getElementById('btn-jump-start');
const btnStepBack = document.getElementById('btn-step-back');
const btnPlayPause = document.getElementById('btn-play-pause');
const playIcon = document.getElementById('play-icon');
const pauseIcon = document.getElementById('pause-icon');
const btnStepFwd = document.getElementById('btn-step-fwd');
const btnStop = document.getElementById('btn-stop');

const btnSplit = document.getElementById('btn-split');
const btnTrimLeft = document.getElementById('btn-trim-left');
const btnTrimRight = document.getElementById('btn-trim-right');
const btnDelete = document.getElementById('btn-delete');
const btnUndo = document.getElementById('btn-undo');

const zoomSlider = document.getElementById('zoom-slider');
const btnZoomOut = document.getElementById('btn-zoom-out');
const btnZoomIn = document.getElementById('btn-zoom-in');

// Clip Drawer DOM
const clipDrawer = document.getElementById('clip-drawer');
const drawerCloseBtn = document.getElementById('drawer-close-btn');
const btnProperties = document.getElementById('btn-properties');
const inspClipName = document.getElementById('insp-clip-name');
const inspClipStart = document.getElementById('insp-clip-start');
const inspClipDuration = document.getElementById('insp-clip-duration');
const inspVolume = document.getElementById('insp-volume');
const inspVolumeVal = document.getElementById('insp-volume-val');
const inspFadeIn = document.getElementById('insp-fade-in');
const inspFadeInVal = document.getElementById('insp-fade-in-val');
const inspFadeOut = document.getElementById('insp-fade-out');
const inspFadeOutVal = document.getElementById('insp-fade-out-val');

const toastEl = document.getElementById('toast');

// Loading Overlay DOM
const loadingOverlay = document.getElementById('loading-overlay');
const loadingTitle = document.getElementById('loading-title');
const loadingSub = document.getElementById('loading-sub');

function showLoading(title = 'Decoding Audio File...', sub = '') {
  if (loadingTitle) loadingTitle.textContent = title;
  if (loadingSub) loadingSub.textContent = sub;
  if (loadingOverlay) loadingOverlay.classList.remove('hidden');
}

function hideLoading() {
  if (loadingOverlay) loadingOverlay.classList.add('hidden');
}

// --- Toast Helper ---
function showToast(message, type = 'info') {
  toastEl.textContent = message;
  toastEl.className = `toast toast-${type}`;
  toastEl.classList.remove('hidden');
  setTimeout(() => {
    toastEl.classList.add('hidden');
  }, 3000);
}

// --- Timecode Update ---
function updateTimecodeDisplay(time = timeline.playheadTime) {
  timecodeCurrent.textContent = formatTime(time);
  timecodeTotal.textContent = formatTime(timeline.getTotalDuration());
}

// --- Inspector Update ---
function updateInspector(clip = timeline.getSelectedClip()) {
  if (!clip) {
    if (clipDrawer) clipDrawer.classList.add('hidden');
    return;
  }

  if (inspClipName) inspClipName.textContent = clip.name;
  if (inspClipStart) inspClipStart.textContent = formatTime(clip.startOnTimeline);
  if (inspClipDuration) inspClipDuration.textContent = `${clip.duration.toFixed(1)}s`;

  const volPercent = Math.round((clip.volume !== undefined ? clip.volume : 1.0) * 100);
  if (inspVolume) inspVolume.value = volPercent;
  if (inspVolumeVal) inspVolumeVal.textContent = `${volPercent}%`;

  if (inspFadeIn) inspFadeIn.value = clip.fadeIn || 0;
  if (inspFadeInVal) inspFadeInVal.textContent = `${(clip.fadeIn || 0).toFixed(1)}s`;

  if (inspFadeOut) inspFadeOut.value = clip.fadeOut || 0;
  if (inspFadeOutVal) inspFadeOutVal.textContent = `${(clip.fadeOut || 0).toFixed(1)}s`;
}

// --- Play / Pause Control ---
function togglePlayback() {
  if (getIsPlaying()) {
    stopTimelinePlayback();
    playIcon.classList.remove('hidden');
    pauseIcon.classList.add('hidden');
  } else {
    playIcon.classList.add('hidden');
    pauseIcon.classList.remove('hidden');

    playTimeline(
      timeline,
      (currentTime) => {
        timelineView.updatePlayheadPosition(currentTime);
        updateTimecodeDisplay(currentTime);
      },
      () => {
        playIcon.classList.remove('hidden');
        pauseIcon.classList.add('hidden');
        updateTimecodeDisplay();
      }
    );
  }
}

// --- Initialize Timeline View ---
const timelineWorkspace = document.getElementById('timeline-workspace');
timelineView = new TimelineView(timelineWorkspace, timeline, {
  onSeek: (time) => {
    syncTimelineSeek(timeline, time);
    if (getIsPlaying()) {
      togglePlayback();
      togglePlayback();
    }
    updateTimecodeDisplay(time);
  },
  onClipSelect: (clip) => {
    updateInspector(clip);
  },
  onClipChange: () => {
    updateTimecodeDisplay();
    updateInspector();
  }
});

// --- Audio File Loading ---
async function handleAudioFiles(files) {
  if (!files || files.length === 0) return;

  const total = files.length;
  let successCount = 0;

  for (let i = 0; i < total; i++) {
    const file = files[i];
    showLoading(
      total > 1 ? `Decoding Audio (${i + 1} of ${total})...` : 'Decoding Audio File...',
      file.name
    );

    // Yield short animation frame tick so browser renders the loading UI immediately
    await new Promise(resolve => setTimeout(resolve, 40));

    try {
      const buffer = await decodeAudioFile(file);
      timeline.addClip(file.name, buffer);
      successCount++;
    } catch (err) {
      console.warn(`Audio decoding warning for ${file.name}:`, err);
      showToast(`Could not decode "${file.name}". Please ensure it is a valid audio file.`, 'error');
    }
  }

  hideLoading();

  if (successCount > 0) {
    syncZoomSlider();
    timelineView.render();
    updateTimecodeDisplay();
    updateInspector();
    showToast(
      successCount === 1 ? 'Audio loaded to timeline!' : `${successCount} audio tracks loaded!`,
      'success'
    );
  }
}

function syncZoomSlider() {
  const total = timeline.getTotalDuration();
  if (total > 3600) {
    zoomSlider.min = '0.2';
    zoomSlider.max = '20';
    zoomSlider.step = '0.2';
  } else if (total > 600) {
    zoomSlider.min = '1';
    zoomSlider.max = '60';
    zoomSlider.step = '0.5';
  } else {
    zoomSlider.min = '5';
    zoomSlider.max = '150';
    zoomSlider.step = '1';
  }
  zoomSlider.value = timeline.zoom;
}

addAudioBtn.addEventListener('click', () => addAudioInput.click());
addAudioInput.addEventListener('change', (e) => {
  handleAudioFiles(e.target.files);
  addAudioInput.value = '';
});

// Drag & drop files onto timeline
timelineWorkspace.addEventListener('dragover', (e) => e.preventDefault());
timelineWorkspace.addEventListener('drop', (e) => {
  e.preventDefault();
  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    handleAudioFiles(e.dataTransfer.files);
  }
});

// --- Transport Listeners ---
btnPlayPause.addEventListener('click', togglePlayback);

btnStop.addEventListener('click', () => {
  stopTimelinePlayback();
  playIcon.classList.remove('hidden');
  pauseIcon.classList.add('hidden');
  timeline.playheadTime = 0;
  syncTimelineSeek(timeline, 0);
  timelineView.updatePlayheadPosition(0);
  updateTimecodeDisplay(0);
});

btnJumpStart.addEventListener('click', () => {
  if (getIsPlaying()) stopTimelinePlayback();
  playIcon.classList.remove('hidden');
  pauseIcon.classList.add('hidden');
  timeline.playheadTime = 0;
  syncTimelineSeek(timeline, 0);
  timelineView.updatePlayheadPosition(0);
  updateTimecodeDisplay(0);
});

btnStepBack.addEventListener('click', () => {
  const newTime = Math.max(0, timeline.playheadTime - 0.1);
  timeline.playheadTime = newTime;
  timelineView.updatePlayheadPosition(newTime);
  updateTimecodeDisplay(newTime);
});

btnStepFwd.addEventListener('click', () => {
  const newTime = Math.min(timeline.getTotalDuration(), timeline.playheadTime + 0.1);
  timeline.playheadTime = newTime;
  timelineView.updatePlayheadPosition(newTime);
  updateTimecodeDisplay(newTime);
});

// --- Timeline Editing Tools ---
// 1. Split
function handleSplit() {
  stopTimelinePlayback();
  const res = timeline.splitAtPlayhead();
  if (res) {
    timelineView.render();
    updateInspector();
    showToast('Split clip at playhead position', 'success');
  } else {
    showToast('No clip found under playhead to split', 'error');
  }
}
btnSplit.addEventListener('click', handleSplit);

// 2. Trim Left
function handleTrimLeft() {
  stopTimelinePlayback();
  const ok = timeline.trimLeftAtPlayhead();
  if (ok) {
    timelineView.render();
    updateTimecodeDisplay();
    updateInspector();
    showToast('Trimmed left', 'success');
  } else {
    showToast('Position playhead inside clip to trim left', 'error');
  }
}
btnTrimLeft.addEventListener('click', handleTrimLeft);

// 3. Trim Right
function handleTrimRight() {
  stopTimelinePlayback();
  const ok = timeline.trimRightAtPlayhead();
  if (ok) {
    timelineView.render();
    updateTimecodeDisplay();
    updateInspector();
    showToast('Trimmed right', 'success');
  } else {
    showToast('Position playhead inside clip to trim right', 'error');
  }
}
btnTrimRight.addEventListener('click', handleTrimRight);

// 4. Delete
function handleDelete() {
  stopTimelinePlayback();
  const ok = timeline.deleteClip(timeline.selectedClipId, true);
  if (ok) {
    timelineView.render();
    updateTimecodeDisplay();
    updateInspector();
    showToast('Clip deleted', 'info');
  } else {
    showToast('Select a clip first to delete', 'error');
  }
}
btnDelete.addEventListener('click', handleDelete);

// 5. Undo
btnUndo.addEventListener('click', () => {
  stopTimelinePlayback();
  const ok = timeline.undo();
  if (ok) {
    timelineView.render();
    updateTimecodeDisplay();
    updateInspector();
    showToast('Undo successful', 'info');
  } else {
    showToast('Nothing to undo', 'info');
  }
});

// --- Zoom Controls ---
zoomSlider.addEventListener('input', () => {
  timeline.zoom = Math.max(0.1, parseFloat(zoomSlider.value) || 1);
  timelineView.render();
});

btnZoomIn.addEventListener('click', () => {
  const step = parseFloat(zoomSlider.step) || 1;
  const current = parseFloat(zoomSlider.value) || 1;
  const max = parseFloat(zoomSlider.max) || 100;
  zoomSlider.value = Math.min(max, current + (step * 2));
  timeline.zoom = parseFloat(zoomSlider.value);
  timelineView.render();
});

btnZoomOut.addEventListener('click', () => {
  const step = parseFloat(zoomSlider.step) || 1;
  const current = parseFloat(zoomSlider.value) || 1;
  const min = parseFloat(zoomSlider.min) || 0.1;
  zoomSlider.value = Math.max(min, current - (step * 2));
  timeline.zoom = parseFloat(zoomSlider.value);
  timelineView.render();
});

// --- Inspector Controls ---
inspVolume.addEventListener('input', () => {
  const vol = parseInt(inspVolume.value, 10) / 100;
  inspVolumeVal.textContent = `${inspVolume.value}%`;
  timeline.setClipVolume(timeline.selectedClipId, vol);
});

inspFadeIn.addEventListener('input', () => {
  const fi = parseFloat(inspFadeIn.value);
  inspFadeInVal.textContent = `${fi.toFixed(1)}s`;
  const clip = timeline.getSelectedClip();
  timeline.setClipFades(timeline.selectedClipId, fi, clip ? clip.fadeOut : 0);
});

inspFadeOut.addEventListener('input', () => {
  const fo = parseFloat(inspFadeOut.value);
  inspFadeOutVal.textContent = `${fo.toFixed(1)}s`;
  const clip = timeline.getSelectedClip();
  timeline.setClipFades(timeline.selectedClipId, clip ? clip.fadeIn : 0, fo);
});

if (btnProperties) {
  btnProperties.addEventListener('click', () => {
    const clip = timeline.getSelectedClip();
    if (!clip) {
      showToast('Select a clip on the timeline first', 'info');
      return;
    }
    updateInspector(clip);
    clipDrawer.classList.toggle('hidden');
  });
}

if (drawerCloseBtn) {
  drawerCloseBtn.addEventListener('click', () => {
    clipDrawer.classList.add('hidden');
  });
}

// --- Master WAV Export ---
exportMasterBtn.addEventListener('click', async () => {
  if (timeline.clips.length === 0) {
    showToast('Timeline is empty! Add audio first.', 'error');
    return;
  }

  stopTimelinePlayback();
  showToast('Rendering timeline to WAV master...', 'info');

  try {
    const blob = await renderMasterWav(timeline);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const ext = blob.type.includes('webm') ? 'webm' : 'wav';
    a.download = `timeline_master_export.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Export downloaded successfully!', 'success');
  } catch (err) {
    console.error(err);
    showToast('Failed to export audio', 'error');
  }
});

// --- Keyboard Shortcuts (NLE Standard) ---
window.addEventListener('keydown', (e) => {
  // Ignore shortcuts if user is typing in an input
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

  if (e.code === 'Space') {
    e.preventDefault();
    togglePlayback();
  } else if (e.key === 's' || e.key === 'S') {
    e.preventDefault();
    handleSplit();
  } else if (e.key === 'q' || e.key === 'Q') {
    e.preventDefault();
    handleTrimLeft();
  } else if (e.key === 'w' || e.key === 'W') {
    e.preventDefault();
    handleTrimRight();
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    handleDelete();
  } else if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
    e.preventDefault();
    timeline.undo();
    timelineView.render();
    updateTimecodeDisplay();
    updateInspector();
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    btnStepBack.click();
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    btnStepFwd.click();
  } else if (e.key === 'Home') {
    e.preventDefault();
    btnJumpStart.click();
  }
});

// Initial render
timelineView.render();
updateTimecodeDisplay();
