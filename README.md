# Web-Tuner

A Chromium extension that detects the pitch currently playing in your browser and tells you what note it is, along with its tuning.

## Features

- 🎵 Real-time pitch detection from browser audio
- 🎼 Accurate note identification (e.g., A4, C#5)
- 📊 Frequency display in Hz
- 🎯 Tuning accuracy in cents (±50 cents range)
- 📈 Visual graph showing tuning offset:
  - Center line (green) = perfectly in tune (0 cents)
  - Above center (red) = sharp (too high)
  - Below center (blue) = flat (too low)
- ✅ In-tune indicator when within ±5 cents

## Installation

### Load as Unpacked Extension (Developer Mode)

1. Download or clone this repository
2. Open Chrome/Chromium browser
3. Navigate to `chrome://extensions/`
4. Enable "Developer mode" (toggle in top-right corner)
5. Click "Load unpacked"
6. Select the `Web-Tuner` directory
7. The extension icon should appear in your browser toolbar

## Usage

1. **Play audio** in any browser tab (YouTube, Spotify, local audio file, etc.)
2. **Click the Web Tuner extension icon** in the toolbar
3. **Click "Start Tuner"** button
4. The extension will request permission to capture the tab's audio
5. Once granted, the tuner will display:
   - Current note being played
   - Frequency in Hz
   - Tuning offset in cents
   - Visual graph showing how sharp or flat the note is

### Tips

- Make sure audio is actually playing in the tab before starting the tuner
- For best results, use clear, sustained single notes (not chords)
- The tuner works best with frequencies between 80 Hz and 2000 Hz
- If no signal is detected, the display will show "No signal"

## How It Works

The extension uses the Web Audio API to:

1. **Capture audio** from the current browser tab using `chrome.tabCapture`
2. **Analyze audio** using the AnalyserNode with FFT (Fast Fourier Transform)
3. **Detect pitch** using an autocorrelation algorithm on the time-domain data
4. **Calculate note** by comparing detected frequency to standard tuning (A4 = 440 Hz)
5. **Compute cents** deviation from the ideal frequency for that note
6. **Display results** with visual feedback

### What are Cents?

A cent is a logarithmic unit of measure for musical intervals. 100 cents = 1 semitone.
- **0 cents** = perfectly in tune
- **+50 cents** = halfway sharp to the next note
- **-50 cents** = halfway flat to the previous note
- **±5 cents** = generally considered "in tune" for most purposes

## Permissions

This extension requires:
- `tabCapture` - to capture audio from the current browser tab
- `activeTab` - to access the active tab

## Browser Compatibility

- Chrome/Chromium (version 88+)
- Microsoft Edge (Chromium-based)
- Other Chromium-based browsers with Manifest V3 support

## License

MIT License - see [LICENSE](LICENSE) file for details
