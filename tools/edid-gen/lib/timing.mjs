import { ESTABLISHED_TIMINGS_MAP } from './constants.mjs';

/**
 * Encode a manufacturer ID from 3 uppercase letters into a 16-bit big-endian value.
 */
export function encodeMfgId(c1, c2, c3) {
  const v = ((c1.charCodeAt(0) - 0x40) & 0x1f) << 10
          | ((c2.charCodeAt(0) - 0x40) & 0x1f) << 5
          | ((c3.charCodeAt(0) - 0x40) & 0x1f);
  // Big-endian: high byte first
  return [(v >> 8) & 0xff, v & 0xff];
}

/**
 * Detect the closest standard EDID aspect ratio for a resolution.
 * Returns the ratio code for standard timing encoding.
 */
export function detectAspectRatio(w, h) {
  const ratio = w / h;
  const ratios = [
    { name: '16:10', code: 0b00, value: 16 / 10 },
    { name: '4:3', code: 0b01, value: 4 / 3 },
    { name: '5:4', code: 0b10, value: 5 / 4 },
    { name: '16:9', code: 0b11, value: 16 / 9 },
  ];
  let best = ratios[0];
  let bestDiff = Math.abs(ratio - best.value);
  for (const r of ratios) {
    const diff = Math.abs(ratio - r.value);
    if (diff < bestDiff) {
      best = r;
      bestDiff = diff;
    }
  }
  return best;
}

/**
 * Encode a detailed timing descriptor (18 bytes).
 * timing: { pixelClockKhz, hActive, hBlanking, hSyncOffset, hSyncPulse,
 *           vActive, vBlanking, vSyncOffset, vSyncPulse, hsyncPol, vsyncPol }
 * displaySizeMm: { hMm, vMm } - display physical size (consistent for all DTDs)
 */
export function encodeDetailedTiming(timing, displaySizeMm) {
  const buf = Buffer.alloc(18);
  const {
    pixelClockKhz, hActive, hBlanking, hSyncOffset, hSyncPulse,
    vActive, vBlanking, vSyncOffset, vSyncPulse, hsyncPol, vsyncPol,
  } = timing;

  // Pixel clock in 10kHz units, little-endian (uint16 max = 65535 → 655.35 MHz)
  const clockVal = Math.round(pixelClockKhz / 10);
  if (clockVal > 65535) {
    throw new Error(
      `Pixel clock ${(pixelClockKhz / 1000).toFixed(1)} MHz exceeds EDID DTD limit of 655.35 MHz ` +
      `(${timing.hActive}x${timing.vActive}@${timing.refreshRate}Hz)`
    );
  }
  buf.writeUInt16LE(clockVal, 0);

  // Horizontal
  buf[2] = hActive & 0xff;
  buf[3] = hBlanking & 0xff;
  buf[4] = ((hActive >> 8) & 0x0f) << 4 | ((hBlanking >> 8) & 0x0f);

  // Vertical
  buf[5] = vActive & 0xff;
  buf[6] = vBlanking & 0xff;
  buf[7] = ((vActive >> 8) & 0x0f) << 4 | ((vBlanking >> 8) & 0x0f);

  // Sync
  buf[8] = hSyncOffset & 0xff;
  buf[9] = hSyncPulse & 0xff;
  buf[10] = ((vSyncOffset & 0x0f) << 4) | (vSyncPulse & 0x0f);
  buf[11] = ((hSyncOffset >> 8) & 0x03) << 6
          | ((hSyncPulse >> 8) & 0x03) << 4
          | ((vSyncOffset >> 4) & 0x03) << 2
          | ((vSyncPulse >> 4) & 0x03);

  // Physical size in mm (same for all DTDs on a fixed-pixel display)
  const { hMm, vMm } = displaySizeMm;
  buf[12] = hMm & 0xff;
  buf[13] = vMm & 0xff;
  buf[14] = ((hMm >> 8) & 0x0f) << 4 | ((vMm >> 8) & 0x0f);

  // No borders
  buf[15] = 0;
  buf[16] = 0;

  // Features: non-interlaced, no stereo, digital separate sync
  buf[17] = 0x18 | ((vsyncPol ? 1 : 0) << 2) | ((hsyncPol ? 1 : 0) << 1);

  return buf;
}

/**
 * Encode a standard timing entry (2 bytes).
 * Only valid for hActive 256-2288 (step 8), refreshRate 60-123,
 * and standard aspect ratios.
 * Returns 2-byte Buffer or null if cannot encode.
 */
export function encodeStandardTiming(hActive, vActive, refreshRate) {
  if (hActive < 256 || hActive > 2288 || hActive % 8 !== 0) return null;
  if (refreshRate < 60 || refreshRate > 123) return null;

  const aspect = detectAspectRatio(hActive, vActive);
  const xByte = (hActive / 8) - 31;
  const yByte = (aspect.code << 6) | (refreshRate - 60);

  return Buffer.from([xByte, yByte]);
}

/**
 * Build the 16-byte standard timings area (bytes 38-53).
 * Up to 8 standard timing entries, unused filled with 0x01 0x01.
 */
export function buildStandardTimings(timings) {
  const buf = Buffer.alloc(16, 0x01);  // Fill with 0x01 (unused marker is 0x0101)
  let idx = 0;

  for (const t of timings) {
    if (idx >= 8) break;
    const encoded = encodeStandardTiming(t.hActive, t.vActive, t.refreshRate);
    if (encoded) {
      encoded.copy(buf, idx * 2);
      idx++;
    }
  }

  return buf;
}

/**
 * Compute established timings bitmap (3 bytes) from the list of timings.
 */
export function computeEstablishedTimings(timings) {
  const bytes = [0, 0, 0];

  for (const t of timings) {
    for (const est of ESTABLISHED_TIMINGS_MAP) {
      if (t.hActive === est.width && t.vActive === est.height && t.refreshRate === est.rate) {
        bytes[est.byte] |= (1 << est.bit);
      }
    }
  }

  return bytes;
}

/**
 * Encode a monitor range limits descriptor (18 bytes, tag 0xFD).
 *
 * edidMinorVersion: 3 for EDID 1.3 (HDMI), 4 for EDID 1.4 (DP).
 * EDID 1.3 does not support rate offset flags (byte 4) or "Range Limits Only"
 * (byte 10 = 0x01), so we use 0x00 (Default GTF) and cap rates at 255.
 */
export function encodeRangeLimits(allTimings, edidMinorVersion, maxVicClockKhz = 0) {
  const buf = Buffer.alloc(18);

  let minVFreq = Infinity, maxVFreq = 0;
  let minHFreq = Infinity, maxHFreq = 0;
  let maxPixelClock = maxVicClockKhz;

  for (const t of allTimings) {
    const vFreq = t.refreshRate;
    const hTotal = t.hActive + t.hBlanking;
    const hFreqKhz = t.pixelClockKhz / hTotal;

    if (vFreq < minVFreq) minVFreq = vFreq;
    if (vFreq > maxVFreq) maxVFreq = vFreq;
    if (hFreqKhz < minHFreq) minHFreq = hFreqKhz;
    if (hFreqKhz > maxHFreq) maxHFreq = hFreqKhz;
    if (t.pixelClockKhz > maxPixelClock) maxPixelClock = t.pixelClockKhz;
  }

  // Descriptor header
  buf[0] = 0; buf[1] = 0;  // Not a detailed timing
  buf[2] = 0;
  buf[3] = 0xfd;  // Monitor range limits tag

  let minV = Math.max(1, Math.floor(minVFreq) - 1);
  let maxV = Math.min(510, Math.ceil(maxVFreq) + 1);
  let minH = Math.max(1, Math.floor(minHFreq) - 1);
  let maxH = Math.min(510, Math.ceil(maxHFreq) + 1);

  if (edidMinorVersion >= 4) {
    // EDID 1.4: byte 4 has rate offset flags for values >255
    let byte4 = 0;
    if (maxV > 255) {
      byte4 |= 0x02;  // Max vertical offset +255
      maxV -= 255;
    }
    if (maxH > 255) {
      byte4 |= 0x08;  // Max horizontal offset +255
      maxH -= 255;
    }
    buf[4] = byte4;
  } else {
    // EDID 1.3: no rate offset flags, cap at 255
    buf[4] = 0x00;
    maxV = Math.min(maxV, 255);
    maxH = Math.min(maxH, 255);
  }

  // Range limits data
  buf[5] = minV;
  buf[6] = maxV;
  buf[7] = minH;
  buf[8] = maxH;
  buf[9] = Math.min(255, Math.ceil(maxPixelClock / 10000) + 1);  // Max pixel clock (10MHz units)

  if (edidMinorVersion >= 4) {
    buf[10] = 0x01;  // Range limits only (no timing formula) - EDID 1.4
  } else {
    buf[10] = 0x00;  // Default GTF - EDID 1.3
  }
  buf[11] = 0x0a;  // End marker

  // Pad with spaces
  for (let i = 12; i < 18; i++) buf[i] = 0x20;

  return buf;
}

/**
 * Encode a display name descriptor (18 bytes, tag 0xFC).
 */
export function encodeDisplayName(name) {
  const buf = Buffer.alloc(18);
  buf[0] = 0; buf[1] = 0;
  buf[2] = 0;
  buf[3] = 0xfc;  // Display name tag
  buf[4] = 0;

  // Name: up to 13 chars, terminated with 0x0a, padded with 0x20
  const nameBytes = Buffer.from(name.substring(0, 13), 'ascii');
  nameBytes.copy(buf, 5);
  const endPos = 5 + Math.min(nameBytes.length, 13);
  if (endPos < 18) buf[endPos] = 0x0a;
  for (let i = endPos + 1; i < 18; i++) buf[i] = 0x20;

  return buf;
}

/**
 * Encode a serial number descriptor (18 bytes, tag 0xFF).
 */
export function encodeSerialDescriptor(serial) {
  const buf = Buffer.alloc(18);
  buf[0] = 0; buf[1] = 0;
  buf[2] = 0;
  buf[3] = 0xff;  // Serial number tag
  buf[4] = 0;

  const serialStr = String(serial).substring(0, 13);
  const serialBytes = Buffer.from(serialStr, 'ascii');
  serialBytes.copy(buf, 5);
  const endPos = 5 + Math.min(serialBytes.length, 13);
  if (endPos < 18) buf[endPos] = 0x0a;
  for (let i = endPos + 1; i < 18; i++) buf[i] = 0x20;

  return buf;
}

/**
 * Compute display physical size in mm from preferred resolution and DPI.
 */
export function computeDisplaySizeMm(preferredTiming, dpi) {
  return {
    hMm: Math.round((preferredTiming.hActive * 25.4) / dpi),
    vMm: Math.round((preferredTiming.vActive * 25.4) / dpi),
  };
}

/**
 * Compute EDID block checksum. The sum of all 128 bytes must be 0 mod 256.
 */
export function computeChecksum(block128) {
  let sum = 0;
  for (let i = 0; i < 127; i++) {
    sum += block128[i];
  }
  return (256 - (sum & 0xff)) & 0xff;
}
