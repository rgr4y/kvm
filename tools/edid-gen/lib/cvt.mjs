/**
 * Native CVT Reduced Blanking v1 timing calculator.
 * No external dependencies — replaces the `cvt` system command.
 *
 * Reference: VESA Coordinated Video Timings (CVT) Standard v1.2
 */

// CVT-RB v1 constants
const RB_H_BLANK = 160;     // Fixed horizontal blanking (pixels)
const RB_H_SYNC = 32;       // Horizontal sync pulse width
const RB_H_FRONT = 48;      // Horizontal front porch
const RB_V_FRONT = 3;       // Vertical front porch (lines)
const RB_MIN_V_BLANK_US = 460.0;  // Minimum vertical blanking period (μs)
const RB_MIN_V_BACK = 6;    // Minimum vertical back porch (lines)
const CLOCK_STEP_KHZ = 250; // Pixel clock granularity (kHz)

/**
 * Determine vertical sync pulse width based on aspect ratio (CVT standard).
 */
function computeVSync(width, height) {
  const r = width / height;
  if (Math.abs(r - 4 / 3) < 0.02) return 4;
  if (Math.abs(r - 16 / 9) < 0.02) return 5;
  if (Math.abs(r - 16 / 10) < 0.02) return 6;
  if (Math.abs(r - 5 / 4) < 0.02) return 7;
  if (Math.abs(r - 15 / 9) < 0.02) return 7;
  return 10;
}

/**
 * Compute CVT Reduced Blanking v1 timing parameters.
 *
 * Works for any resolution and refresh rate — the "multiples of 60Hz only"
 * restriction in the system `cvt -r` command is a VESA certification rule,
 * not a mathematical limitation.
 */
export function computeTiming(width, height, refreshRate) {
  const hTotal = width + RB_H_BLANK;
  const vSync = computeVSync(width, height);

  // Estimate horizontal period (μs per line)
  const hPeriodUs = (1e6 / refreshRate - RB_MIN_V_BLANK_US) / (height + RB_V_FRONT);

  // Vertical blanking lines
  const vbiLines = Math.floor(RB_MIN_V_BLANK_US / hPeriodUs) + 1;
  const minVbi = RB_V_FRONT + vSync + RB_MIN_V_BACK;
  const actVbi = Math.max(vbiLines, minVbi);

  const vTotal = height + actVbi;

  // Pixel clock rounded down to nearest step
  const rawClockKhz = refreshRate * vTotal * hTotal / 1000;
  const pixelClockKhz = Math.floor(rawClockKhz / CLOCK_STEP_KHZ) * CLOCK_STEP_KHZ;

  return {
    pixelClockKhz,
    hActive: width,
    hBlanking: RB_H_BLANK,
    hSyncOffset: RB_H_FRONT,
    hSyncPulse: RB_H_SYNC,
    vActive: height,
    vBlanking: actVbi,
    vSyncOffset: RB_V_FRONT,
    vSyncPulse: vSync,
    hsyncPol: 1,   // Positive H-sync (CVT-RB)
    vsyncPol: 0,   // Negative V-sync (CVT-RB)
    refreshRate,
    reducedBlanking: true,
  };
}
