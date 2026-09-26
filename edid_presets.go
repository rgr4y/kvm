package kvm

import (
	"bytes"
	"encoding/hex"
	"fmt"
	"strings"
)

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
// donor monitor's name). Disabled presets have no verified blob yet.
type EDIDPreset struct {
	ID       string   `json:"id"`
	Label    string   `json:"label"`
	Caps     EDIDCaps `json:"caps"`
	EDIDHex  string   `json:"edidHex"`
	Disabled bool     `json:"disabled"`
	Note     string   `json:"note,omitempty"`
}

// Verified, checksum-valid EDID blobs. The 1080p default is the one kvm_app has
// always shipped; the 1200p blob is a real dump. Both are relabeled here by the
// mode they force, not by monitor name.
const (
	edid1080p60 = "00ffffffffffff0052620188008888881c150103800000780a0dc9a05747982712484c00000001010101010101010101010101010101023a801871382d40582c4500c48e2100001e011d007251d01e206e285500c48e2100001e000000fc00543734392d6648443732300a20000000fd00147801ff1d000a202020202020017b"

	edid1920x1200 = "00FFFFFFFFFFFF00047265058A3F6101101E0104A53420783FC125A8554EA0260D5054BFEF80714F8140818081C081008B009500B300283C80A070B023403020360006442100001A000000FD00304C575716010A202020202020000000FC0042323436574C0A202020202020000000FF0054384E4545303033383532320A01F802031CF14F90020304050607011112131415161F2309070783010000011D8018711C1620582C250006442100009E011D007251D01E206E28550006442100001E8C0AD08A20E02D10103E9600064421000018C344806E70B028401720A80406442100001E00000000000000000000000000000000000000000000000000000096"
)

// edidPresets is the source of truth for the "pick a mode" picker. Caps are
// filled in at request time by parsing EDIDHex.
var edidPresets = []EDIDPreset{
	{
		ID:      "1080p60",
		Label:   "1080p60",
		EDIDHex: edid1080p60,
	},
	{
		ID:      "1920x1200-60",
		Label:   "1920x1200 · 60Hz",
		EDIDHex: edid1920x1200,
	},
	{
		ID:       "720p60",
		Label:    "720p60",
		Disabled: true,
		Note:     "TODO: needs a verified 720p60 EDID blob (kernel edid/1280x720 or edid-decode-verified)",
	},
	{
		ID:       "1080p30",
		Label:    "1080p30",
		Disabled: true,
		Note:     "TODO: needs a verified 1080p30 EDID blob",
	},
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

// rpcGetEDIDPresets returns the preset list with caps parsed from each blob and
// the label rewritten to match the EDID's real native mode.
func rpcGetEDIDPresets() ([]EDIDPreset, error) {
	out := make([]EDIDPreset, 0, len(edidPresets))
	for _, p := range edidPresets {
		if p.EDIDHex != "" {
			if caps, err := parseEDIDCaps(p.EDIDHex); err == nil {
				p.Caps = caps
				p.Label = edidNameForCaps(caps)
			}
		}
		out = append(out, p)
	}
	return out, nil
}

// rpcSetEDIDPreset applies a preset's EDID by id via the existing set_edid path
// (so persistence and the native apply are unchanged). Raw-hex custom EDIDs keep
// using rpcSetEDID.
func rpcSetEDIDPreset(id string) error {
	for _, p := range edidPresets {
		if p.ID == id {
			if p.Disabled || p.EDIDHex == "" {
				return fmt.Errorf("edid preset %q is not available", id)
			}
			// Rewrite the monitor-name descriptor so the captured host reports
			// "KVM <mode>" instead of the donor monitor's model, then apply.
			blob := p.EDIDHex
			if caps, err := parseEDIDCaps(blob); err == nil {
				if named, err := setEDIDMonitorName(blob, edidNameForCaps(caps)); err == nil {
					blob = named
				}
			}
			logger.Info().Str("preset", id).Msg("Applying EDID preset")
			return rpcSetEDID(blob)
		}
	}
	return fmt.Errorf("unknown edid preset %q", id)
}
