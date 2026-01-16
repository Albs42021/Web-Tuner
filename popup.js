// Tuner state
let audioContext = null;
let analyser = null;
let mediaStream = null;
let animationFrameId = null;
let isRunning = false;

// UI Elements
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const statusDiv = document.getElementById('status');
const tunerDiv = document.getElementById('tuner');
const noteDisplay = document.getElementById('note');
const frequencyDisplay = document.getElementById('frequency');
const centsDisplay = document.getElementById('cents');
const canvas = document.getElementById('tunerGraph');
const ctx = canvas.getContext('2d');

// Note definitions (A4 = 440 Hz)
const noteStrings = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Event listeners
startBtn.addEventListener('click', startTuner);
stopBtn.addEventListener('click', stopTuner);

// Start the tuner
async function startTuner() {
  try {
    statusDiv.textContent = 'Requesting audio access...';
    
    // Request tab audio capture
    const streamId = await new Promise((resolve, reject) => {
      chrome.tabCapture.capture({
        audio: true,
        video: false
      }, (stream) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else if (stream) {
          resolve(stream);
        } else {
          reject(new Error('No stream returned'));
        }
      });
    });
    
    mediaStream = streamId;
    
    // Setup Web Audio API
    audioContext = new AudioContext();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 8192; // Higher FFT size for better low-frequency resolution
    analyser.smoothingTimeConstant = 0.8;
    
    const source = audioContext.createMediaStreamSource(mediaStream);
    source.connect(analyser);
    
    isRunning = true;
    startBtn.style.display = 'none';
    stopBtn.style.display = 'block';
    tunerDiv.style.display = 'block';
    statusDiv.textContent = 'Tuner active - play audio in this tab';
    
    // Start analyzing
    detectPitch();
  } catch (error) {
    console.error('Error starting tuner:', error);
    statusDiv.textContent = 'Error: ' + error.message + '. Make sure audio is playing in this tab.';
  }
}

// Stop the tuner
function stopTuner() {
  isRunning = false;
  
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
  }
  
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
  }
  
  if (audioContext) {
    audioContext.close();
  }
  
  startBtn.style.display = 'block';
  stopBtn.style.display = 'none';
  tunerDiv.style.display = 'none';
  statusDiv.textContent = 'Click "Start" to begin tuning';
  
  // Clear displays
  noteDisplay.textContent = '-';
  frequencyDisplay.textContent = '- Hz';
  centsDisplay.textContent = '-';
  clearGraph();
}

// Pitch detection using autocorrelation
function detectPitch() {
  if (!isRunning) return;
  
  const bufferLength = analyser.fftSize;
  const buffer = new Float32Array(bufferLength);
  analyser.getFloatTimeDomainData(buffer);
  
  // Calculate RMS to check if there's enough signal
  const rms = Math.sqrt(buffer.reduce((sum, val) => sum + val * val, 0) / buffer.length);
  
  if (rms < 0.01) {
    // Not enough signal
    noteDisplay.textContent = '-';
    frequencyDisplay.textContent = '- Hz';
    centsDisplay.textContent = 'No signal';
    centsDisplay.className = 'cents';
    drawGraph(0, false);
  } else {
    // Detect pitch using autocorrelation
    const frequency = autoCorrelate(buffer, audioContext.sampleRate);
    
    if (frequency > 0) {
      const note = frequencyToNote(frequency);
      const cents = frequencyToCents(frequency, note.frequency);
      
      // Update displays
      noteDisplay.textContent = note.name + note.octave;
      frequencyDisplay.textContent = frequency.toFixed(2) + ' Hz';
      
      let centsText = '';
      if (Math.abs(cents) < 5) {
        centsText = 'In Tune ✓';
        centsDisplay.className = 'cents in-tune';
      } else if (cents > 0) {
        centsText = '+' + cents.toFixed(0) + ' cents (Sharp)';
        centsDisplay.className = 'cents sharp';
      } else {
        centsText = cents.toFixed(0) + ' cents (Flat)';
        centsDisplay.className = 'cents flat';
      }
      centsDisplay.textContent = centsText;
      
      // Draw graph
      drawGraph(cents, true);
    } else {
      noteDisplay.textContent = '-';
      frequencyDisplay.textContent = '- Hz';
      centsDisplay.textContent = 'Detecting...';
      centsDisplay.className = 'cents';
      drawGraph(0, false);
    }
  }
  
  animationFrameId = requestAnimationFrame(detectPitch);
}

// Autocorrelation algorithm for pitch detection
function autoCorrelate(buffer, sampleRate) {
  const SIZE = buffer.length;
  const MAX_SAMPLES = Math.floor(SIZE / 2);
  let best_offset = -1;
  let best_correlation = 0;
  let rms = 0;
  
  // Calculate RMS
  for (let i = 0; i < SIZE; i++) {
    const val = buffer[i];
    rms += val * val;
  }
  rms = Math.sqrt(rms / SIZE);
  
  if (rms < 0.01) return -1; // Not enough signal
  
  // Find the best offset
  let lastCorrelation = 1;
  for (let offset = 1; offset < MAX_SAMPLES; offset++) {
    let correlation = 0;
    
    for (let i = 0; i < MAX_SAMPLES; i++) {
      correlation += Math.abs(buffer[i] - buffer[i + offset]);
    }
    
    correlation = 1 - (correlation / MAX_SAMPLES);
    
    if (correlation > 0.9 && correlation > lastCorrelation) {
      const foundGoodCorrelation = correlation > best_correlation;
      if (foundGoodCorrelation) {
        best_correlation = correlation;
        best_offset = offset;
      }
    }
    
    lastCorrelation = correlation;
  }
  
  if (best_correlation > 0.01 && best_offset !== -1) {
    const frequency = sampleRate / best_offset;
    return frequency;
  }
  
  return -1;
}

// Convert frequency to note name and octave
function frequencyToNote(frequency) {
  const noteNum = 12 * (Math.log(frequency / 440) / Math.log(2));
  const noteIndex = Math.round(noteNum) + 69; // A4 is MIDI note 69
  const octave = Math.floor(noteIndex / 12) - 1;
  const noteName = noteStrings[noteIndex % 12];
  
  // Calculate the ideal frequency for this note
  const idealFrequency = 440 * Math.pow(2, (noteIndex - 69) / 12);
  
  return {
    name: noteName,
    octave: octave,
    frequency: idealFrequency,
    midiNote: noteIndex
  };
}

// Calculate cents deviation from the ideal note frequency
function frequencyToCents(frequency, idealFrequency) {
  return Math.floor(1200 * Math.log(frequency / idealFrequency) / Math.log(2));
}

// Draw the tuning graph
function drawGraph(cents, hasSignal) {
  const width = canvas.width;
  const height = canvas.height;
  const centerY = height / 2;
  
  // Clear canvas
  ctx.clearRect(0, 0, width, height);
  
  // Background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  
  // Draw center line (0 cents - in tune)
  ctx.strokeStyle = '#51cf66';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, centerY);
  ctx.lineTo(width, centerY);
  ctx.stroke();
  
  // Draw +/- 50 cent markers
  ctx.strokeStyle = '#dee2e6';
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 5]);
  
  // +25 cents line
  ctx.beginPath();
  ctx.moveTo(0, centerY - 25);
  ctx.lineTo(width, centerY - 25);
  ctx.stroke();
  
  // -25 cents line
  ctx.beginPath();
  ctx.moveTo(0, centerY + 25);
  ctx.lineTo(width, centerY + 25);
  ctx.stroke();
  
  ctx.setLineDash([]);
  
  // Draw labels
  ctx.fillStyle = '#495057';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('+50¢ Sharp', width - 5, centerY - 35);
  ctx.fillText('0¢ In Tune', width - 5, centerY - 5);
  ctx.fillText('-50¢ Flat', width - 5, centerY + 45);
  
  if (hasSignal) {
    // Clamp cents to -50 to +50 range for display
    const clampedCents = Math.max(-50, Math.min(50, cents));
    const indicatorY = centerY - clampedCents; // Negative because canvas Y increases downward
    
    // Draw indicator
    let color;
    if (Math.abs(cents) < 5) {
      color = '#51cf66'; // Green - in tune
    } else if (cents > 0) {
      color = '#ff6b6b'; // Red - sharp
    } else {
      color = '#4ecdc4'; // Blue - flat
    }
    
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(width / 2, indicatorY, 8, 0, 2 * Math.PI);
    ctx.fill();
    
    // Draw vertical line from indicator to center
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(width / 2, indicatorY);
    ctx.lineTo(width / 2, centerY);
    ctx.stroke();
  }
}

// Clear the graph
function clearGraph() {
  const width = canvas.width;
  const height = canvas.height;
  
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#f8f9fa';
  ctx.fillRect(0, 0, width, height);
}

// Initialize graph on load
clearGraph();
