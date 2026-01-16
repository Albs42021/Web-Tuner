// Tuner state
let audioContext = null;
let analyser = null;
let mediaStream = null;
let animationFrameId = null;
let isRunning = false;
let lastFrequency = -1;
let frequencyHistory = [];

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
    analyser.smoothingTimeConstant = 0.3; // Lower smoothing for faster response
    
    const source = audioContext.createMediaStreamSource(mediaStream);
    source.connect(analyser);
    analyser.connect(audioContext.destination); // Allow audio to pass through to speakers
    
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
  
  // Clear displays and history
  noteDisplay.textContent = '-';
  frequencyDisplay.textContent = '- Hz';
  centsDisplay.textContent = '-';
  lastFrequency = -1;
  frequencyHistory = [];
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
      // Apply temporal smoothing to reduce jitter
      const smoothedFrequency = smoothFrequency(frequency);
      
      const note = frequencyToNote(smoothedFrequency);
      const cents = frequencyToCents(smoothedFrequency, note.frequency);
      
      // Update displays
      noteDisplay.textContent = note.name + note.octave;
      frequencyDisplay.textContent = smoothedFrequency.toFixed(2) + ' Hz';
      
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
  
  // Define frequency range constraints (82 Hz to 1000 Hz)
  // This prevents detecting very low frequencies that cause octave errors
  const MIN_FREQUENCY = 82; // E2
  const MAX_FREQUENCY = 1000; // B5
  const MAX_OFFSET = Math.floor(sampleRate / MIN_FREQUENCY);
  const MIN_OFFSET = Math.floor(sampleRate / MAX_FREQUENCY);
  
  // Calculate RMS
  let rms = 0;
  for (let i = 0; i < SIZE; i++) {
    const val = buffer[i];
    rms += val * val;
  }
  rms = Math.sqrt(rms / SIZE);
  
  if (rms < 0.01) return -1; // Not enough signal
  
  // Normalize the buffer
  const normalizedBuffer = new Float32Array(SIZE);
  for (let i = 0; i < SIZE; i++) {
    normalizedBuffer[i] = buffer[i] / rms;
  }
  
  let best_offset = -1;
  let best_correlation = 0;
  
  // Search for the best autocorrelation within frequency constraints
  for (let offset = MIN_OFFSET; offset < Math.min(MAX_OFFSET, MAX_SAMPLES); offset++) {
    let correlation = 0;
    
    // Calculate autocorrelation for this offset
    for (let i = 0; i < MAX_SAMPLES; i++) {
      correlation += normalizedBuffer[i] * normalizedBuffer[i + offset];
    }
    
    correlation = correlation / MAX_SAMPLES;
    
    // Look for strong positive correlation
    if (correlation > best_correlation) {
      best_correlation = correlation;
      best_offset = offset;
    }
  }
  
  // Require a strong correlation to avoid spurious detections
  // Higher threshold reduces false positives and octave errors
  if (best_correlation > 0.5 && best_offset !== -1) {
    // Refine the period estimate using parabolic interpolation
    let refined_offset = best_offset;
    
    if (best_offset > MIN_OFFSET && best_offset < MAX_OFFSET - 1) {
      // Calculate correlation at neighboring offsets
      let c1 = 0, c2 = 0, c3 = 0;
      
      for (let i = 0; i < MAX_SAMPLES; i++) {
        c1 += normalizedBuffer[i] * normalizedBuffer[i + best_offset - 1];
        c2 += normalizedBuffer[i] * normalizedBuffer[i + best_offset];
        c3 += normalizedBuffer[i] * normalizedBuffer[i + best_offset + 1];
      }
      
      c1 /= MAX_SAMPLES;
      c2 /= MAX_SAMPLES;
      c3 /= MAX_SAMPLES;
      
      // Parabolic interpolation
      const delta = 0.5 * (c1 - c3) / (c1 - 2 * c2 + c3);
      if (!isNaN(delta) && Math.abs(delta) < 1) {
        refined_offset = best_offset + delta;
      }
    }
    
    const frequency = sampleRate / refined_offset;
    
    // Double-check frequency is in valid range
    if (frequency >= MIN_FREQUENCY && frequency <= MAX_FREQUENCY) {
      return frequency;
    }
  }
  
  return -1;
}

// Smooth frequency readings over time to reduce jitter
function smoothFrequency(frequency) {
  const HISTORY_SIZE = 5;
  const SMOOTHING_FACTOR = 0.7;
  
  // Add to history
  frequencyHistory.push(frequency);
  if (frequencyHistory.length > HISTORY_SIZE) {
    frequencyHistory.shift();
  }
  
  // If we have a previous reading, apply weighted average
  if (lastFrequency > 0) {
    // Check if the new frequency is within a reasonable range of the last one
    // This prevents sudden octave jumps
    const ratio = frequency / lastFrequency;
    
    // If the ratio is close to 0.5, 2, 4, etc., it might be an octave error
    // In such cases, prefer the previous frequency with stronger smoothing
    if (Math.abs(ratio - 0.5) < 0.1 || Math.abs(ratio - 2.0) < 0.2) {
      // Likely octave error, heavily favor previous frequency
      frequency = lastFrequency * 0.9 + frequency * 0.1;
    } else if (Math.abs(ratio - 1.0) < 0.5) {
      // Normal variation, apply standard smoothing
      frequency = lastFrequency * SMOOTHING_FACTOR + frequency * (1 - SMOOTHING_FACTOR);
    } else {
      // Large jump - might be a real note change, use median of recent history
      if (frequencyHistory.length >= 3) {
        const sorted = [...frequencyHistory].sort((a, b) => a - b);
        frequency = sorted[Math.floor(sorted.length / 2)];
      }
    }
  }
  
  lastFrequency = frequency;
  return frequency;
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
