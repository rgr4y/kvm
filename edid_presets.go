package kvm

import (
	"bytes"
	"embed"
	"encoding/hex"
	"fmt"
	"strings"
)

// edidBlobFS holds the generated EDID preset blobs (see tools/edid-gen). Each
// mode ships in a plain and an "-audio" (LPCM stereo) variant; the variant is
// chosen at apply time. Blobs are byte-for-byte the output of the vendored
// builder and are checksum-valid, so kvm_app never assembles EDID at runtime.
//
//go:embed edid_blobs/*.bin
var edidBlobFS embed.FS

// loadEDIDBlob returns the hex-encoded EDID for a mode id, picking the audio
// variant when requested. Missing blobs are a build error (embed is compile-time),
// so a lookup miss means an unknown id.
func loadEDIDBlob(id string, audio bool) (string, error) {
	name := id
	if audio {
		name += "-audio"
	}
	b, err := edidBlobFS.ReadFile("edid_blobs/" + name + ".bin")
	if err != nil {
		return "", fmt.Errorf("no EDID blob for %q (audio=%v): %w", id, audio, err)
	}
	return hex.EncodeToString(b), nil
}

// EDIDCaps describes what a captured target host will output when handed a given
// EDID: the mode advertised by detailed timing #1, plus audio/HDR flags parsed
// from the CEA-861 extension. Parsed from the blob so a label can never silently
// disagree with what the EDID actually says.
type EDIDCaps struct {
	MaxRes  string `json:"maxRes"`  // e.g. "1920x1080" (detailed timing #1)
	Refresh int    `json:"refresh"` // Hz
	HDR     bool   `json:"hdr"`
	Audio   bool   `json:"audio"`
}

// EDIDPreset is a capability-labeled EDID the user picks by mode (not by the
// donor monitor's name). Caps are parsed from the blob at request time.
type EDIDPreset struct {
	ID       string   `json:"id"`
	Label    string   `json:"label"`
	Caps     EDIDCaps `json:"caps"`
	EDIDHex  string   `json:"edidHex"`
	Disabled bool     `json:"disabled"`
	Note     string   `json:"note,omitempty"`
}

// edidModeIDs is the source of truth for the "pick a mode" picker, ordered for
// display. Each id has a plain and an "-audio" blob under edid_blobs/, generated
// by tools/edid-gen from the vendored VESA/CTA builder. Labels and caps are
// derived from the blob so they can never disagree with what the EDID advertises.
var edidModeIDs = []string{
	"720p60",
	"1080p60",
	"1080p30",
	"1920x1200-60",
	// 1440p60 (~241MHz) and 2160p30 (~297MHz) exceed the TC358743 HDMI-RX
	// bridge's 165MHz pixel-clock ceiling (HDMI 1.4a), so the host outputs a mode
	// the capture path can't ingest and video is lost. Blobs stay shipped under
	// edid_blobs/; re-enable only against a verified higher-clock capture limit.
	// "1440p60",
	// "2160p30",
}

// validateEDID checks structural validity: whole 128-byte blocks, the fixed
// header, and a zero checksum per block. Used by tests to keep a malformed blob
// (which would break the target handshake) from ever shipping.
func validateEDID(hexStr string) error {
	b, err := hex.DecodeString(strings.TrimSpace(hexStr))
	if err != nil {
		return fmt.Errorf("not valid hex: %w", err)
	}
	if len(b) == 0 || len(b)%128 != 0 {
		return fmt.Errorf("length %d is not a multiple of 128", len(b))
	}
	if !bytes.Equal(b[0:8], []byte{0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00}) {
		return fmt.Errorf("bad EDID header")
	}
	for blk := 0; blk < len(b); blk += 128 {
		var sum byte
		for _, x := range b[blk : blk+128] {
			sum += x
		}
		if sum != 0 {
			return fmt.Errorf("block %d checksum invalid", blk/128)
		}
	}
	return nil
}

// parseEDIDCaps derives display capabilities from an EDID blob: resolution and
// refresh from detailed timing descriptor #1, and audio/HDR from the CEA-861
// extension block if present.
func parseEDIDCaps(hexStr string) (EDIDCaps, error) {
	b, err := hex.DecodeString(strings.TrimSpace(hexStr))
	if err != nil {
		return EDIDCaps{}, err
	}
	if len(b) < 128 {
		return EDIDCaps{}, fmt.Errorf("edid too short: %d bytes", len(b))
	}

	caps := EDIDCaps{}

	// Detailed Timing Descriptor #1 lives at offset 54 (18 bytes).
	d := b[54:72]
	pixClkKHz := (int(d[1])<<8 | int(d[0])) * 10
	if pixClkKHz > 0 {
		hActive := (int(d[4]&0xF0) << 4) | int(d[2])
		hBlank := (int(d[4]&0x0F) << 8) | int(d[3])
		vActive := (int(d[7]&0xF0) << 4) | int(d[5])
		vBlank := (int(d[7]&0x0F) << 8) | int(d[6])
		hTotal := hActive + hBlank
		vTotal := vActive + vBlank
		caps.MaxRes = fmt.Sprintf("%dx%d", hActive, vActive)
		if hTotal > 0 && vTotal > 0 {
			caps.Refresh = int(float64(pixClkKHz*1000)/float64(hTotal*vTotal) + 0.5)
		}
	}

	// CEA-861 extension block (audio / HDR), if the base block declares one.
	if len(b) >= 256 && b[126] > 0 && b[128] == 0x02 {
		ext := b[128:256]
		// byte 3: bit6 = basic audio supported.
		if ext[3]&0x40 != 0 {
			caps.Audio = true
		}
		dtdStart := int(ext[2])
		if dtdStart >= 4 && dtdStart <= len(ext) {
			i := 4
			for i < dtdStart {
				tag := ext[i] >> 5
				length := int(ext[i] & 0x1F)
				switch tag {
				case 1: // Audio Data Block
					caps.Audio = true
				case 7: // Use Extended Tag
					if i+1 < len(ext) && ext[i+1] == 6 { // HDR Static Metadata Data Block
						caps.HDR = true
					}
				}
				i += 1 + length
			}
		}
	}

	return caps, nil
}

// capsLabel builds a human label from parsed caps: the native mode the EDID
// forces (detailed timing #1), in "1080p60" shorthand where the width matches a
// standard height, else the raw "WxH@Hz". Derived from the blob so the label
// always states what the EDID actually advertises, never a donor monitor's name.
func capsLabel(caps EDIDCaps) string {
	if caps.MaxRes == "" {
		return ""
	}
	// Map "WxH" to "Hp" shorthand for the common broadcast/PC heights.
	short := map[string]string{
		"1280x720":  "720p",
		"1920x1080": "1080p",
		"2560x1440": "1440p",
		"3840x2160": "2160p",
	}[caps.MaxRes]
	if short == "" {
		// Non-standard height: keep the raw "WxH", no refresh suffix (reads
		// cleanly and keeps the monitor-name field within its 13-char limit).
		return caps.MaxRes // e.g. "1920x1200"
	}
	if caps.Refresh > 0 {
		return fmt.Sprintf("%s%d", short, caps.Refresh) // e.g. "1080p60"
	}
	return short
}

// edidNameForCaps is the friendly name shown in the picker and written into the
// EDID's monitor-name descriptor, so the captured host reports "KVM 1080p60"
// instead of the donor monitor's model. Empty caps yield a plain "KVM".
func edidNameForCaps(caps EDIDCaps) string {
	if lbl := capsLabel(caps); lbl != "" {
		return "KVM " + lbl
	}
	return "KVM"
}

// setEDIDMonitorName rewrites the base block's Monitor Name descriptor (tag 0xFC)
// text to name (13-byte field: 0x0A-terminated, 0x20-padded, truncated if longer)
// and recomputes the base block checksum. If the blob has no 0xFC descriptor it
// is returned unchanged. The CEA extension block, if any, is untouched.
func setEDIDMonitorName(hexStr, name string) (string, error) {
	b, err := hex.DecodeString(strings.TrimSpace(hexStr))
	if err != nil {
		return "", err
	}
	if len(b) < 128 {
		return "", fmt.Errorf("edid too short: %d bytes", len(b))
	}

	// The four 18-byte descriptors start at offset 54 in the base block.
	for _, off := range []int{54, 72, 90, 108} {
		if b[off] == 0 && b[off+1] == 0 && b[off+2] == 0 && b[off+3] == 0xFC && b[off+4] == 0 {
			field := b[off+5 : off+18] // 13-byte text field
			for i := range field {
				field[i] = 0x20
			}
			n := copy(field, []byte(name))
			if n < len(field) {
				field[n] = 0x0A // terminate names shorter than 13 chars
			}
			// Recompute base block checksum: all 128 bytes must sum to 0 mod 256.
			var sum byte
			for _, x := range b[0:127] {
				sum += x
			}
			b[127] = byte(-int(sum) & 0xFF)
			return hex.EncodeToString(b), nil
		}
	}
	return hexStr, nil
}

// rpcGetEDIDPresets returns one preset per mode, caps parsed from the (plain)
// embedded blob and the label set to the mode's friendly "KVM <mode>" name. Every
// mode also has an audio variant, surfaced via Caps.Audio being available on
// apply; the picker uses a separate audio toggle rather than doubling the list.
func rpcGetEDIDPresets() ([]EDIDPreset, error) {
	out := make([]EDIDPreset, 0, len(edidModeIDs))
	for _, id := range edidModeIDs {
		blob, err := loadEDIDBlob(id, false)
		if err != nil {
			return nil, err
		}
		p := EDIDPreset{ID: id, EDIDHex: blob}
		if caps, err := parseEDIDCaps(blob); err == nil {
			p.Caps = caps
			p.Label = edidNameForCaps(caps)
		} else {
			p.Label = id
		}
		out = append(out, p)
	}
	return out, nil
}

// rpcSetEDIDPreset applies a mode's EDID by id, picking the audio variant when
// requested, via the existing set_edid path (persistence and native apply
// unchanged). The monitor-name descriptor is rewritten to "KVM <mode>" so the
// captured host reports the mode, not a donor model. Raw-hex custom EDIDs keep
// using rpcSetEDID.
func rpcSetEDIDPreset(id string, audio bool) error {
	blob, err := loadEDIDBlob(id, audio)
	if err != nil {
		return fmt.Errorf("edid preset %q is not available: %w", id, err)
	}
	if caps, err := parseEDIDCaps(blob); err == nil {
		if named, err := setEDIDMonitorName(blob, edidNameForCaps(caps)); err == nil {
			blob = named
		}
	}
	logger.Info().Str("preset", id).Bool("audio", audio).Msg("Applying EDID preset")
	return rpcSetEDID(blob)
}
