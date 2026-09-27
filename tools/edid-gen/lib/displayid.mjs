import { computeChecksum, computeDisplaySizeMm } from './timing.mjs';

/**
 * Detect the closest DisplayID 2.0 aspect ratio code for a resolution.
 */
function detectDisplayIdAspect(width, height) {
  const ratio = width / height;
  const aspects = [
    { code: 0x0, value: 1 },        // 1:1
    { code: 0x1, value: 5 / 4 },    // 5:4
    { code: 0x2, value: 4 / 3 },    // 4:3
    { code: 0x3, value: 15 / 9 },   // 15:9
    { code: 0x4, value: 16 / 9 },   // 16:9
    { code: 0x5, value: 16 / 10 },  // 16:10
    { code: 0x6, value: 64 / 27 },  // 64:27
    { code: 0x7, value: 256 / 135 },// 256:135
  ];
  let best = aspects[4];
  let bestDiff = Math.abs(ratio - best.value);
  for (const a of aspects) {
    const diff = Math.abs(ratio - a.value);
    if (diff < bestDiff) {
      best = a;
      bestDiff = diff;
    }
  }
  return best.code;
}

/**
 * Encode a DisplayID 2.0 Type VII Detailed Timing Descriptor (20 bytes).
 *
 * All numeric fields use "minus 1" encoding (stored = actual - 1).
 * Pixel clock is 24-bit LE in 1 kHz units (stored as value - 1).
 * Sync polarities are in bit 7 of the front porch high bytes.
 */
function encodeTypeVIITiming(timing, isPreferred) {
  const buf = Buffer.alloc(20);
  const {
    pixelClockKhz, hActive, hBlanking, hSyncOffset, hSyncPulse,
    vActive, vBlanking, vSyncOffset, vSyncPulse, hsyncPol, vsyncPol,
  } = timing;

  const clockM1 = pixelClockKhz - 1;
  buf[0] = clockM1 & 0xff;
  buf[1] = (clockM1 >> 8) & 0xff;
  buf[2] = (clockM1 >> 16) & 0xff;

  const aspect = detectDisplayIdAspect(hActive, vActive);
  buf[3] = (isPreferred ? 0x80 : 0x00) | (aspect & 0x0f);

  const hActM1 = hActive - 1;
  buf[4] = hActM1 & 0xff;
  buf[5] = (hActM1 >> 8) & 0xff;

  const hBlkM1 = hBlanking - 1;
  buf[6] = hBlkM1 & 0xff;
  buf[7] = (hBlkM1 >> 8) & 0xff;

  const hFpM1 = hSyncOffset - 1;
  buf[8] = hFpM1 & 0xff;
  buf[9] = ((hsyncPol ? 1 : 0) << 7) | ((hFpM1 >> 8) & 0x7f);

  const hSwM1 = hSyncPulse - 1;
  buf[10] = hSwM1 & 0xff;
  buf[11] = (hSwM1 >> 8) & 0xff;

  const vActM1 = vActive - 1;
  buf[12] = vActM1 & 0xff;
  buf[13] = (vActM1 >> 8) & 0xff;

  const vBlkM1 = vBlanking - 1;
  buf[14] = vBlkM1 & 0xff;
  buf[15] = (vBlkM1 >> 8) & 0xff;

  const vFpM1 = vSyncOffset - 1;
  buf[16] = vFpM1 & 0xff;
  buf[17] = ((vsyncPol ? 1 : 0) << 7) | ((vFpM1 >> 8) & 0x7f);

  const vSwM1 = vSyncPulse - 1;
  buf[18] = vSwM1 & 0xff;
  buf[19] = (vSwM1 >> 8) & 0xff;

  return buf;
}

/**
 * Encode a CIE chromaticity coordinate pair (x, y) as 3 bytes.
 * Each coordinate is a 12-bit value: actual = stored / 4096.
 * Packed as: [x_low8] [x_high4 | y_high4] [y_low8]
 */
function encodeCIExy(x, y) {
  const xVal = Math.round(x * 4096) & 0xfff;
  const yVal = Math.round(y * 4096) & 0xfff;
  return [
    xVal & 0xff,
    ((xVal >> 8) & 0x0f) | ((yVal >> 4) & 0xf0),
    yVal & 0xff,
  ];
}

/**
 * Encode a DisplayID 2.0 Display Parameters Data Block (tag 0x21).
 * Payload: 29 bytes (required by DisplayID 2.0 spec).
 *
 *   [0-1]   Horizontal image size in 1/10 mm (LE)
 *   [2-3]   Vertical image size in 1/10 mm (LE)
 *   [4-5]   Horizontal pixel count (LE)
 *   [6-7]   Vertical pixel count (LE)
 *   [8]     Features/scan orientation
 *   [9-11]  Primary 1 (Red) CIE xy
 *   [12-14] Primary 2 (Green) CIE xy
 *   [15-17] Primary 3 (Blue) CIE xy
 *   [18-20] White point CIE xy
 *   [21-22] Max luminance full coverage (IEEE half-float)
 *   [23-24] Max luminance 10% coverage (IEEE half-float)
 *   [25-26] Min luminance (IEEE half-float)
 *   [27]    Native color depth & transfer characteristics
 *   [28]    Gamma × 100 - 100
 */
function encodeDisplayParamsBlock(buf, offset, displaySizeMm, hPixels, vPixels) {
  buf[offset]     = 0x21;  // Tag: Display Parameters
  buf[offset + 1] = 0x00;  // Revision 0
  buf[offset + 2] = 29;    // Payload length

  const p = offset + 3;  // Payload start

  // Image size in 1/10 mm
  const hSizeTenths = displaySizeMm.hMm * 10;
  const vSizeTenths = displaySizeMm.vMm * 10;
  buf[p]     = hSizeTenths & 0xff;
  buf[p + 1] = (hSizeTenths >> 8) & 0xff;
  buf[p + 2] = vSizeTenths & 0xff;
  buf[p + 3] = (vSizeTenths >> 8) & 0xff;

  // Native pixel count
  buf[p + 4] = hPixels & 0xff;
  buf[p + 5] = (hPixels >> 8) & 0xff;
  buf[p + 6] = vPixels & 0xff;
  buf[p + 7] = (vPixels >> 8) & 0xff;

  // Features: no audio, no deinterlacing, scan direction not defined
  buf[p + 8] = 0x00;

  // sRGB chromaticity: Red(0.640,0.330) Green(0.300,0.600) Blue(0.150,0.060) White(0.3127,0.3290)
  const red   = encodeCIExy(0.640, 0.330);
  const green = encodeCIExy(0.300, 0.600);
  const blue  = encodeCIExy(0.150, 0.060);
  const white = encodeCIExy(0.3127, 0.3290);

  buf[p + 9]  = red[0];   buf[p + 10] = red[1];   buf[p + 11] = red[2];
  buf[p + 12] = green[0]; buf[p + 13] = green[1]; buf[p + 14] = green[2];
  buf[p + 15] = blue[0];  buf[p + 16] = blue[1];  buf[p + 17] = blue[2];
  buf[p + 18] = white[0]; buf[p + 19] = white[1]; buf[p + 20] = white[2];

  // Luminance: max 300 cd/m2, 10% 400 cd/m2, min 0.5 cd/m2
  // Encoded as 16-bit unsigned in 0.01 cd/m2 units (stored LE)
  // Max full: 300 → 30000 = 0x7530
  buf[p + 21] = 0x30; buf[p + 22] = 0x75;
  // Max 10%: 400 → 40000 = 0x9C40
  buf[p + 23] = 0x40; buf[p + 24] = 0x9C;
  // Min: 0.5 → 50 = 0x0032
  buf[p + 25] = 0x32; buf[p + 26] = 0x00;

  // Native color depth: 0x26 = 8bpc RGB
  buf[p + 27] = 0x26;

  // Gamma: 2.20 → (2.20 * 100) - 100 = 120
  buf[p + 28] = 120;

  return 3 + 29;  // header + payload
}

/**
 * Build a DisplayID 2.0 extension block (128 bytes) containing
 * Display Parameters Data Block + Type VII Detailed Timing Data Block.
 *
 * timings: array of timing objects (up to 4 per block, 20 bytes each)
 * preferredTiming: the overall preferred timing object
 * displaySizeMm: { hMm, vMm }
 * isFirst: if true, include Display Parameters block + mark first timing preferred
 */
export function buildDisplayIdExtensionBlock(timings, preferredTiming, displaySizeMm, isFirst, extensionCount = 0) {
  const buf = Buffer.alloc(128);
  // With Display Params (32 bytes header+payload), we have room for 3 timings (32+3+60=95 < 121)
  // Without, 5 timings (3+100=103 < 121)
  const maxTimings = Math.min(timings.length, isFirst ? 3 : 5);

  // EDID extension tag
  buf[0] = 0x70;

  // DisplayID 2.0 header
  buf[1] = 0x20;  // Version 2.0
  // buf[2] = section size — filled below
  buf[3] = isFirst ? 0x02 : 0x00;  // Primary use case: generic display (first only, 0 for extensions)
  buf[4] = extensionCount;          // Number of additional DisplayID extension blocks that follow

  let offset = 5;

  // Display Parameters Data Block (first DisplayID block only)
  if (isFirst && displaySizeMm) {
    const hPx = preferredTiming ? preferredTiming.hActive : 0;
    const vPx = preferredTiming ? preferredTiming.vActive : 0;
    offset += encodeDisplayParamsBlock(buf, offset, displaySizeMm, hPx, vPx);
  }

  // Type VII data block
  const timingPayloadLen = maxTimings * 20;
  buf[offset]     = 0x22;  // Tag: Type VII Detailed Timing
  buf[offset + 1] = 0x00;  // Revision 0
  buf[offset + 2] = timingPayloadLen;
  offset += 3;

  // Check if preferred timing is among our timings
  const hasPreferred = timings.some(t => t === preferredTiming);

  for (let i = 0; i < maxTimings; i++) {
    const t = timings[i];
    // Mark preferred if it's the actual preferred, or mark first timing if preferred isn't in this block
    const isPreferred = (t === preferredTiming) || (!hasPreferred && i === 0);
    encodeTypeVIITiming(t, isPreferred).copy(buf, offset);
    offset += 20;
  }

  // Section size: bytes from byte 5 to end of data blocks
  const sectionSize = offset - 5;
  buf[2] = sectionSize;

  // DisplayID section checksum
  const checksumPos = sectionSize + 5;
  let didSum = 0;
  for (let i = 1; i < checksumPos; i++) {
    didSum += buf[i];
  }
  buf[checksumPos] = (256 - (didSum & 0xff)) & 0xff;

  // EDID block checksum (byte 127)
  buf[127] = computeChecksum(buf);

  return buf;
}
