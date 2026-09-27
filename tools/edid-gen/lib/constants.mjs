export const MAX_SVD_VICS = 31;

export const REFRESH_RATE_PRESETS = [24, 30, 48, 60, 75, 90, 120, 144, 165, 240, 360];

// Established timings bitmap (bytes 35-37 of base EDID block)
// Each entry: [byteIndex (0-2), bitMask]
export const ESTABLISHED_TIMINGS_MAP = [
  { width: 720, height: 400, rate: 70, byte: 0, bit: 7 },
  { width: 720, height: 400, rate: 88, byte: 0, bit: 6 },
  { width: 640, height: 480, rate: 60, byte: 0, bit: 5 },
  { width: 640, height: 480, rate: 67, byte: 0, bit: 4 },
  { width: 640, height: 480, rate: 72, byte: 0, bit: 3 },
  { width: 640, height: 480, rate: 75, byte: 0, bit: 2 },
  { width: 800, height: 600, rate: 56, byte: 0, bit: 1 },
  { width: 800, height: 600, rate: 60, byte: 0, bit: 0 },
  { width: 800, height: 600, rate: 72, byte: 1, bit: 7 },
  { width: 800, height: 600, rate: 75, byte: 1, bit: 6 },
  { width: 832, height: 624, rate: 75, byte: 1, bit: 5 },
  { width: 1024, height: 768, rate: 87, byte: 1, bit: 4 },  // interlaced
  { width: 1024, height: 768, rate: 60, byte: 1, bit: 3 },
  { width: 1024, height: 768, rate: 72, byte: 1, bit: 2 },
  { width: 1024, height: 768, rate: 75, byte: 1, bit: 1 },
  { width: 1280, height: 1024, rate: 75, byte: 1, bit: 0 },
  { width: 1152, height: 870, rate: 75, byte: 2, bit: 7 },
];

// sRGB chromaticity coordinates (bytes 25-34)
export const SRGB_CHROMATICITY = Buffer.from([
  0x5e, 0xc0,       // Red/Green LSBs, Blue/White LSBs
  0xa4, 0x59,       // Red x, Red y MSBs
  0x4a, 0x98,       // Green x, Green y MSBs
  0x25, 0x20,       // Blue x, Blue y MSBs
  0x50, 0x54,       // White x, White y MSBs
]);

// BT.2020 chromaticity coordinates (bytes 25-34)
// Red (0.708, 0.292), Green (0.170, 0.797), Blue (0.131, 0.046), White D65 (0.3127, 0.3290)
export const BT2020_CHROMATICITY = Buffer.from([
  0x78, 0xb1,       // Red/Green LSBs, Blue/White LSBs
  0xb5, 0x4a,       // Red x, Red y MSBs
  0x2b, 0xcc,       // Green x, Green y MSBs
  0x21, 0x0b,       // Blue x, Blue y MSBs
  0x50, 0x54,       // White x, White y MSBs
]);

// Color depth encoding for EDID 1.4 byte 20 (bits 6-4)
export const COLOR_DEPTH_BITS = {
  6: 0b001,
  8: 0b010,
  10: 0b011,
  12: 0b100,
};

// Interface encoding for EDID 1.4 byte 20 (bits 3-0)
export const INTERFACE_BITS = {
  'HDMI': 0b0010,       // HDMI-a
  'DisplayPort': 0b0101,
};

// Audio configurations: SAD byte 1 = (1 << 3) | (channels - 1), format code 1 = LPCM
// Speaker allocation byte 1 bits: 0=FL/FR 1=LFE1 2=FC 3=BL/BR
// Speaker allocation byte 2 bits: 5=SiL/SiR (side left/right)
export const AUDIO_CONFIGS = {
  stereo:     { channels: 2, sadByte1: 0x09, speakerAlloc: 0x01, speakerAlloc2: 0x00 },  // FL/FR
  surround51: { channels: 6, sadByte1: 0x0D, speakerAlloc: 0x0F, speakerAlloc2: 0x00 },  // +LFE+FC+BL/BR
  surround71: { channels: 8, sadByte1: 0x0F, speakerAlloc: 0x0F, speakerAlloc2: 0x08 },  // +LS/RS (Left/Right Surround, CTA-861-H compliant)
};

// CTA-861-H VIC (Video Identification Code) table
// VIC number → { width, height, rate, clockKhz } for standard CEA/CTA timings
// clockKhz is the standard pixel clock defined by CTA-861 (differs from CVT-computed values)
// Verified via edid-decode brute-force on 2026-03-19
export const VIC_TABLE = new Map([
  // 480p/576p
  [1,   { width: 640,  height: 480,  rate: 60,  clockKhz: 25175 }],
  [2,   { width: 720,  height: 480,  rate: 60,  clockKhz: 27000 }],
  [3,   { width: 720,  height: 480,  rate: 60,  clockKhz: 27000 }],   // 16:9
  [4,   { width: 1280, height: 720,  rate: 60,  clockKhz: 74250 }],
  [16,  { width: 1920, height: 1080, rate: 60,  clockKhz: 148500 }],
  [17,  { width: 720,  height: 576,  rate: 50,  clockKhz: 27000 }],
  [18,  { width: 720,  height: 576,  rate: 50,  clockKhz: 27000 }],   // 16:9
  [19,  { width: 1280, height: 720,  rate: 50,  clockKhz: 74250 }],
  [31,  { width: 1920, height: 1080, rate: 50,  clockKhz: 148500 }],
  [32,  { width: 1920, height: 1080, rate: 24,  clockKhz: 74250 }],
  [33,  { width: 1920, height: 1080, rate: 25,  clockKhz: 74250 }],
  [34,  { width: 1920, height: 1080, rate: 30,  clockKhz: 74250 }],
  // 1080p high refresh
  [63,  { width: 1920, height: 1080, rate: 120, clockKhz: 297000 }],
  [64,  { width: 1920, height: 1080, rate: 100, clockKhz: 297000 }],
  // 4K UHD (16:9)
  [93,  { width: 3840, height: 2160, rate: 24,  clockKhz: 297000 }],
  [94,  { width: 3840, height: 2160, rate: 25,  clockKhz: 297000 }],
  [95,  { width: 3840, height: 2160, rate: 30,  clockKhz: 297000 }],
  [96,  { width: 3840, height: 2160, rate: 50,  clockKhz: 594000 }],
  [97,  { width: 3840, height: 2160, rate: 60,  clockKhz: 594000 }],
  [114, { width: 3840, height: 2160, rate: 48,  clockKhz: 594000 }],
  [117, { width: 3840, height: 2160, rate: 100, clockKhz: 1188000 }],
  [118, { width: 3840, height: 2160, rate: 120, clockKhz: 1188000 }],
  // 4096x2160 (DCI 4K, 256:135)
  [98,  { width: 4096, height: 2160, rate: 24,  clockKhz: 297000 }],
  [99,  { width: 4096, height: 2160, rate: 25,  clockKhz: 297000 }],
  [100, { width: 4096, height: 2160, rate: 30,  clockKhz: 297000 }],
  [101, { width: 4096, height: 2160, rate: 50,  clockKhz: 594000 }],
  [102, { width: 4096, height: 2160, rate: 60,  clockKhz: 594000 }],
  [218, { width: 4096, height: 2160, rate: 100, clockKhz: 1188000 }],
  [219, { width: 4096, height: 2160, rate: 120, clockKhz: 1188000 }],
  // 5120x2160 (64:27)
  [121, { width: 5120, height: 2160, rate: 24,  clockKhz: 396000 }],
  [122, { width: 5120, height: 2160, rate: 25,  clockKhz: 396000 }],
  [123, { width: 5120, height: 2160, rate: 30,  clockKhz: 396000 }],
  [124, { width: 5120, height: 2160, rate: 48,  clockKhz: 742500 }],
  [125, { width: 5120, height: 2160, rate: 50,  clockKhz: 742500 }],
  [126, { width: 5120, height: 2160, rate: 60,  clockKhz: 742500 }],
  [127, { width: 5120, height: 2160, rate: 100, clockKhz: 1485000 }],
  [193, { width: 5120, height: 2160, rate: 120, clockKhz: 1485000 }],
  // 7680x4320 (8K, 16:9)
  [194, { width: 7680, height: 4320, rate: 24,  clockKhz: 1188000 }],
  [195, { width: 7680, height: 4320, rate: 25,  clockKhz: 1188000 }],
  [196, { width: 7680, height: 4320, rate: 30,  clockKhz: 1188000 }],
  [197, { width: 7680, height: 4320, rate: 48,  clockKhz: 2376000 }],
  [198, { width: 7680, height: 4320, rate: 50,  clockKhz: 2376000 }],
  [199, { width: 7680, height: 4320, rate: 60,  clockKhz: 2376000 }],
  [200, { width: 7680, height: 4320, rate: 100, clockKhz: 4752000 }],
  [201, { width: 7680, height: 4320, rate: 120, clockKhz: 4752000 }],
]);

// HDMI 2.1 Fixed Rate Link (FRL) levels
// Each level defines max lanes, per-lane rate (Gbps), and total bandwidth (Gbps)
export const FRL_LEVELS = [
  { level: 0, lanes: 0, rateGbps: 0,  bandwidthGbps: 0 },
  { level: 1, lanes: 3, rateGbps: 3,  bandwidthGbps: 9 },
  { level: 2, lanes: 3, rateGbps: 6,  bandwidthGbps: 18 },
  { level: 3, lanes: 4, rateGbps: 6,  bandwidthGbps: 24 },
  { level: 4, lanes: 4, rateGbps: 8,  bandwidthGbps: 32 },
  { level: 5, lanes: 4, rateGbps: 10, bandwidthGbps: 40 },
  { level: 6, lanes: 4, rateGbps: 12, bandwidthGbps: 48 },
];

/**
 * CTA-861 standard timing parameters for all VICs in VIC_TABLE.
 * Extracted from edid-decode 1.32.0 to ensure DTDs match CTA-861 exactly.
 * Used when the base block DTD must match the first SVD VIC exactly.
 */
// Regenerated from edid-decode 1.32.0 on 2026-03-20
export const VIC_STANDARD_TIMINGS = new Map([
  [1,   { pixelClockKhz: 25175,   hActive: 640,  hBlanking: 160,  hSyncOffset: 16,   hSyncPulse: 96,  vActive: 480,  vBlanking: 45,  vSyncOffset: 10, vSyncPulse: 2,  hsyncPol: false, vsyncPol: false, refreshRate: 60 }],
  [2,   { pixelClockKhz: 27000,   hActive: 720,  hBlanking: 138,  hSyncOffset: 16,   hSyncPulse: 62,  vActive: 480,  vBlanking: 45,  vSyncOffset: 9,  vSyncPulse: 6,  hsyncPol: false, vsyncPol: false, refreshRate: 60 }],
  [3,   { pixelClockKhz: 27000,   hActive: 720,  hBlanking: 138,  hSyncOffset: 16,   hSyncPulse: 62,  vActive: 480,  vBlanking: 45,  vSyncOffset: 9,  vSyncPulse: 6,  hsyncPol: false, vsyncPol: false, refreshRate: 60 }],
  [4,   { pixelClockKhz: 74250,   hActive: 1280, hBlanking: 370,  hSyncOffset: 110,  hSyncPulse: 40,  vActive: 720,  vBlanking: 30,  vSyncOffset: 5,  vSyncPulse: 5,  hsyncPol: true,  vsyncPol: true,  refreshRate: 60 }],
  [16,  { pixelClockKhz: 148500,  hActive: 1920, hBlanking: 280,  hSyncOffset: 88,   hSyncPulse: 44,  vActive: 1080, vBlanking: 45,  vSyncOffset: 4,  vSyncPulse: 5,  hsyncPol: true,  vsyncPol: true,  refreshRate: 60 }],
  [17,  { pixelClockKhz: 27000,   hActive: 720,  hBlanking: 144,  hSyncOffset: 12,   hSyncPulse: 64,  vActive: 576,  vBlanking: 49,  vSyncOffset: 5,  vSyncPulse: 5,  hsyncPol: false, vsyncPol: false, refreshRate: 50 }],
  [18,  { pixelClockKhz: 27000,   hActive: 720,  hBlanking: 144,  hSyncOffset: 12,   hSyncPulse: 64,  vActive: 576,  vBlanking: 49,  vSyncOffset: 5,  vSyncPulse: 5,  hsyncPol: false, vsyncPol: false, refreshRate: 50 }],
  [19,  { pixelClockKhz: 74250,   hActive: 1280, hBlanking: 700,  hSyncOffset: 440,  hSyncPulse: 40,  vActive: 720,  vBlanking: 30,  vSyncOffset: 5,  vSyncPulse: 5,  hsyncPol: true,  vsyncPol: true,  refreshRate: 50 }],
  [31,  { pixelClockKhz: 148500,  hActive: 1920, hBlanking: 720,  hSyncOffset: 528,  hSyncPulse: 44,  vActive: 1080, vBlanking: 45,  vSyncOffset: 4,  vSyncPulse: 5,  hsyncPol: true,  vsyncPol: true,  refreshRate: 50 }],
  [32,  { pixelClockKhz: 74250,   hActive: 1920, hBlanking: 830,  hSyncOffset: 638,  hSyncPulse: 44,  vActive: 1080, vBlanking: 45,  vSyncOffset: 4,  vSyncPulse: 5,  hsyncPol: true,  vsyncPol: true,  refreshRate: 24 }],
  [33,  { pixelClockKhz: 74250,   hActive: 1920, hBlanking: 720,  hSyncOffset: 528,  hSyncPulse: 44,  vActive: 1080, vBlanking: 45,  vSyncOffset: 4,  vSyncPulse: 5,  hsyncPol: true,  vsyncPol: true,  refreshRate: 25 }],
  [34,  { pixelClockKhz: 74250,   hActive: 1920, hBlanking: 280,  hSyncOffset: 88,   hSyncPulse: 44,  vActive: 1080, vBlanking: 45,  vSyncOffset: 4,  vSyncPulse: 5,  hsyncPol: true,  vsyncPol: true,  refreshRate: 30 }],
  [63,  { pixelClockKhz: 297000,  hActive: 1920, hBlanking: 280,  hSyncOffset: 88,   hSyncPulse: 44,  vActive: 1080, vBlanking: 45,  vSyncOffset: 4,  vSyncPulse: 5,  hsyncPol: true,  vsyncPol: true,  refreshRate: 120 }],
  [64,  { pixelClockKhz: 297000,  hActive: 1920, hBlanking: 720,  hSyncOffset: 528,  hSyncPulse: 44,  vActive: 1080, vBlanking: 45,  vSyncOffset: 4,  vSyncPulse: 5,  hsyncPol: true,  vsyncPol: true,  refreshRate: 100 }],
  // 3840x2160 (4K UHD, 16:9)
  [93,  { pixelClockKhz: 297000,  hActive: 3840, hBlanking: 1660, hSyncOffset: 1276, hSyncPulse: 88,  vActive: 2160, vBlanking: 90,  vSyncOffset: 8,  vSyncPulse: 10, hsyncPol: true,  vsyncPol: true,  refreshRate: 24 }],
  [94,  { pixelClockKhz: 297000,  hActive: 3840, hBlanking: 1440, hSyncOffset: 1056, hSyncPulse: 88,  vActive: 2160, vBlanking: 90,  vSyncOffset: 8,  vSyncPulse: 10, hsyncPol: true,  vsyncPol: true,  refreshRate: 25 }],
  [95,  { pixelClockKhz: 297000,  hActive: 3840, hBlanking: 560,  hSyncOffset: 176,  hSyncPulse: 88,  vActive: 2160, vBlanking: 90,  vSyncOffset: 8,  vSyncPulse: 10, hsyncPol: true,  vsyncPol: true,  refreshRate: 30 }],
  [96,  { pixelClockKhz: 594000,  hActive: 3840, hBlanking: 1440, hSyncOffset: 1056, hSyncPulse: 88,  vActive: 2160, vBlanking: 90,  vSyncOffset: 8,  vSyncPulse: 10, hsyncPol: true,  vsyncPol: true,  refreshRate: 50 }],
  [97,  { pixelClockKhz: 594000,  hActive: 3840, hBlanking: 560,  hSyncOffset: 176,  hSyncPulse: 88,  vActive: 2160, vBlanking: 90,  vSyncOffset: 8,  vSyncPulse: 10, hsyncPol: true,  vsyncPol: true,  refreshRate: 60 }],
  [114, { pixelClockKhz: 594000,  hActive: 3840, hBlanking: 1660, hSyncOffset: 1276, hSyncPulse: 88,  vActive: 2160, vBlanking: 90,  vSyncOffset: 8,  vSyncPulse: 10, hsyncPol: true,  vsyncPol: true,  refreshRate: 48 }],
  [117, { pixelClockKhz: 1188000, hActive: 3840, hBlanking: 1440, hSyncOffset: 1056, hSyncPulse: 88,  vActive: 2160, vBlanking: 90,  vSyncOffset: 8,  vSyncPulse: 10, hsyncPol: true,  vsyncPol: true,  refreshRate: 100 }],
  [118, { pixelClockKhz: 1188000, hActive: 3840, hBlanking: 560,  hSyncOffset: 176,  hSyncPulse: 88,  vActive: 2160, vBlanking: 90,  vSyncOffset: 8,  vSyncPulse: 10, hsyncPol: true,  vsyncPol: true,  refreshRate: 120 }],
  // 4096x2160 (DCI 4K, 256:135)
  [98,  { pixelClockKhz: 297000,  hActive: 4096, hBlanking: 1404, hSyncOffset: 1020, hSyncPulse: 88,  vActive: 2160, vBlanking: 90,  vSyncOffset: 8,  vSyncPulse: 10, hsyncPol: true,  vsyncPol: true,  refreshRate: 24 }],
  [99,  { pixelClockKhz: 297000,  hActive: 4096, hBlanking: 1184, hSyncOffset: 968,  hSyncPulse: 88,  vActive: 2160, vBlanking: 90,  vSyncOffset: 8,  vSyncPulse: 10, hsyncPol: true,  vsyncPol: true,  refreshRate: 25 }],
  [100, { pixelClockKhz: 297000,  hActive: 4096, hBlanking: 304,  hSyncOffset: 88,   hSyncPulse: 88,  vActive: 2160, vBlanking: 90,  vSyncOffset: 8,  vSyncPulse: 10, hsyncPol: true,  vsyncPol: true,  refreshRate: 30 }],
  [101, { pixelClockKhz: 594000,  hActive: 4096, hBlanking: 1184, hSyncOffset: 968,  hSyncPulse: 88,  vActive: 2160, vBlanking: 90,  vSyncOffset: 8,  vSyncPulse: 10, hsyncPol: true,  vsyncPol: true,  refreshRate: 50 }],
  [102, { pixelClockKhz: 594000,  hActive: 4096, hBlanking: 304,  hSyncOffset: 88,   hSyncPulse: 88,  vActive: 2160, vBlanking: 90,  vSyncOffset: 8,  vSyncPulse: 10, hsyncPol: true,  vsyncPol: true,  refreshRate: 60 }],
  [218, { pixelClockKhz: 1188000, hActive: 4096, hBlanking: 1184, hSyncOffset: 800,  hSyncPulse: 88,  vActive: 2160, vBlanking: 90,  vSyncOffset: 8,  vSyncPulse: 10, hsyncPol: true,  vsyncPol: true,  refreshRate: 100 }],
  [219, { pixelClockKhz: 1188000, hActive: 4096, hBlanking: 304,  hSyncOffset: 88,   hSyncPulse: 88,  vActive: 2160, vBlanking: 90,  vSyncOffset: 8,  vSyncPulse: 10, hsyncPol: true,  vsyncPol: true,  refreshRate: 120 }],
  // 5120x2160 (64:27)
  [121, { pixelClockKhz: 396000,  hActive: 5120, hBlanking: 2380, hSyncOffset: 1996, hSyncPulse: 88,  vActive: 2160, vBlanking: 40,  vSyncOffset: 8,  vSyncPulse: 10, hsyncPol: true,  vsyncPol: true,  refreshRate: 24 }],
  [122, { pixelClockKhz: 396000,  hActive: 5120, hBlanking: 2080, hSyncOffset: 1696, hSyncPulse: 88,  vActive: 2160, vBlanking: 40,  vSyncOffset: 8,  vSyncPulse: 10, hsyncPol: true,  vsyncPol: true,  refreshRate: 25 }],
  [123, { pixelClockKhz: 396000,  hActive: 5120, hBlanking: 880,  hSyncOffset: 664,  hSyncPulse: 88,  vActive: 2160, vBlanking: 40,  vSyncOffset: 8,  vSyncPulse: 10, hsyncPol: true,  vsyncPol: true,  refreshRate: 30 }],
  [124, { pixelClockKhz: 742500,  hActive: 5120, hBlanking: 1130, hSyncOffset: 746,  hSyncPulse: 88,  vActive: 2160, vBlanking: 315, vSyncOffset: 8,  vSyncPulse: 10, hsyncPol: true,  vsyncPol: true,  refreshRate: 48 }],
  [125, { pixelClockKhz: 742500,  hActive: 5120, hBlanking: 1480, hSyncOffset: 1096, hSyncPulse: 88,  vActive: 2160, vBlanking: 90,  vSyncOffset: 8,  vSyncPulse: 10, hsyncPol: true,  vsyncPol: true,  refreshRate: 50 }],
  [126, { pixelClockKhz: 742500,  hActive: 5120, hBlanking: 380,  hSyncOffset: 164,  hSyncPulse: 88,  vActive: 2160, vBlanking: 90,  vSyncOffset: 8,  vSyncPulse: 10, hsyncPol: true,  vsyncPol: true,  refreshRate: 60 }],
  [127, { pixelClockKhz: 1485000, hActive: 5120, hBlanking: 1480, hSyncOffset: 1096, hSyncPulse: 88,  vActive: 2160, vBlanking: 90,  vSyncOffset: 8,  vSyncPulse: 10, hsyncPol: true,  vsyncPol: true,  refreshRate: 100 }],
  [193, { pixelClockKhz: 1485000, hActive: 5120, hBlanking: 380,  hSyncOffset: 164,  hSyncPulse: 88,  vActive: 2160, vBlanking: 90,  vSyncOffset: 8,  vSyncPulse: 10, hsyncPol: true,  vsyncPol: true,  refreshRate: 120 }],
  // 7680x4320 (8K, 16:9)
  [194, { pixelClockKhz: 1188000, hActive: 7680, hBlanking: 3320, hSyncOffset: 2552, hSyncPulse: 176, vActive: 4320, vBlanking: 180, vSyncOffset: 16, vSyncPulse: 20, hsyncPol: true,  vsyncPol: true,  refreshRate: 24 }],
  [195, { pixelClockKhz: 1188000, hActive: 7680, hBlanking: 3120, hSyncOffset: 2352, hSyncPulse: 176, vActive: 4320, vBlanking: 80,  vSyncOffset: 16, vSyncPulse: 20, hsyncPol: true,  vsyncPol: true,  refreshRate: 25 }],
  [196, { pixelClockKhz: 1188000, hActive: 7680, hBlanking: 1320, hSyncOffset: 552,  hSyncPulse: 176, vActive: 4320, vBlanking: 80,  vSyncOffset: 16, vSyncPulse: 20, hsyncPol: true,  vsyncPol: true,  refreshRate: 30 }],
  [197, { pixelClockKhz: 2376000, hActive: 7680, hBlanking: 3320, hSyncOffset: 2552, hSyncPulse: 176, vActive: 4320, vBlanking: 180, vSyncOffset: 16, vSyncPulse: 20, hsyncPol: true,  vsyncPol: true,  refreshRate: 48 }],
  [198, { pixelClockKhz: 2376000, hActive: 7680, hBlanking: 3120, hSyncOffset: 2352, hSyncPulse: 176, vActive: 4320, vBlanking: 80,  vSyncOffset: 16, vSyncPulse: 20, hsyncPol: true,  vsyncPol: true,  refreshRate: 50 }],
  [199, { pixelClockKhz: 2376000, hActive: 7680, hBlanking: 1320, hSyncOffset: 552,  hSyncPulse: 176, vActive: 4320, vBlanking: 80,  vSyncOffset: 16, vSyncPulse: 20, hsyncPol: true,  vsyncPol: true,  refreshRate: 60 }],
  [200, { pixelClockKhz: 4752000, hActive: 7680, hBlanking: 2880, hSyncOffset: 2112, hSyncPulse: 176, vActive: 4320, vBlanking: 180, vSyncOffset: 16, vSyncPulse: 20, hsyncPol: true,  vsyncPol: true,  refreshRate: 100 }],
  [201, { pixelClockKhz: 4752000, hActive: 7680, hBlanking: 1120, hSyncOffset: 352,  hSyncPulse: 176, vActive: 4320, vBlanking: 180, vSyncOffset: 16, vSyncPulse: 20, hsyncPol: true,  vsyncPol: true,  refreshRate: 120 }],
]);

/**
 * Find all matching VIC numbers for a given resolution and refresh rate.
 * Returns an array of VIC numbers (may be empty).
 */
export function findMatchingVics(width, height, refreshRate) {
  const rate = Math.round(refreshRate);
  const vics = [];
  for (const [vic, info] of VIC_TABLE) {
    if (info.width === width && info.height === height && info.rate === rate) {
      vics.push(vic);
    }
  }
  return vics;
}

// Labels for VIC resolutions
const VIC_RESOLUTION_LABELS = {
  '640x480':   '640x480 (VGA, 4:3)',
  '720x480':   '720x480 (NTSC, 4:3)',
  '720x576':   '720x576 (PAL, 4:3)',
  '1280x720':  '1280x720 (HD, 16:9)',
  '1920x1080': '1920x1080 (FHD, 16:9)',
  '3840x2160': '3840x2160 (4K UHD, 16:9)',
  '4096x2160': '4096x2160 (DCI 4K, ~17:9)',
  '5120x2160': '5120x2160 (5K UW, ~21:9)',
  '7680x4320': '7680x4320 (8K UHD, 16:9)',
};

/**
 * Derive unique resolutions from VIC_TABLE, sorted by pixel count.
 * Returns array of { width, height, label }.
 */
export function getVicResolutions() {
  const seen = new Set();
  const resolutions = [];
  for (const [, info] of VIC_TABLE) {
    const key = `${info.width}x${info.height}`;
    if (!seen.has(key)) {
      seen.add(key);
      resolutions.push({
        width: info.width,
        height: info.height,
        label: VIC_RESOLUTION_LABELS[key] || key,
      });
    }
  }
  resolutions.sort((a, b) => (a.width * a.height) - (b.width * b.height));
  return resolutions;
}

/**
 * Return sorted array of refresh rates that have a VIC for the given resolution.
 */
export function getVicRatesForResolution(width, height) {
  const rates = new Set();
  for (const [, info] of VIC_TABLE) {
    if (info.width === width && info.height === height) {
      rates.add(info.rate);
    }
  }
  return [...rates].sort((a, b) => a - b);
}
