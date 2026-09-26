package kvm

import (
	"bytes"
	"encoding/hex"
	"testing"
)

// expectedMode is the resolution/refresh each embedded blob's detailed timing #1
// must advertise, so a regenerated or swapped blob can't silently drift.
var expectedMode = map[string]struct {
	res     string
	refresh int
}{
	"720p60":       {"1280x720", 60},
	"1080p60":      {"1920x1080", 60},
	"1080p30":      {"1920x1080", 30},
	"1920x1200-60": {"1920x1200", 60}, // CVT-RB rounds to 60 (59.95 -> 60)
	"1440p60":      {"2560x1440", 60},
	"2160p30":      {"3840x2160", 30},
}

// Every mode's plain and audio blob must be structurally valid (header +
// per-block checksum) and advertise its expected native mode — a malformed or
// mislabeled blob would break the captured target's EDID handshake.
func TestEDIDPresetsValid(t *testing.T) {
	for _, id := range edidModeIDs {
		want, ok := expectedMode[id]
		if !ok {
			t.Errorf("mode %q has no expected-mode entry", id)
			continue
		}
		for _, audio := range []bool{false, true} {
			blob, err := loadEDIDBlob(id, audio)
			if err != nil {
				t.Errorf("mode %q (audio=%v): load: %v", id, audio, err)
				continue
			}
			if err := validateEDID(blob); err != nil {
				t.Errorf("mode %q (audio=%v): invalid EDID: %v", id, audio, err)
				continue
			}
			caps, err := parseEDIDCaps(blob)
			if err != nil {
				t.Errorf("mode %q (audio=%v): parse caps: %v", id, audio, err)
				continue
			}
			if caps.MaxRes != want.res {
				t.Errorf("mode %q: resolution = %q, want %q", id, caps.MaxRes, want.res)
			}
			if caps.Refresh != want.refresh {
				t.Errorf("mode %q: refresh = %d, want %d", id, caps.Refresh, want.refresh)
			}
			if caps.Audio != audio {
				t.Errorf("mode %q (audio=%v): Caps.Audio = %v, want %v", id, audio, caps.Audio, audio)
			}
		}
	}
}

// rpcGetEDIDPresets must return one labeled preset per mode with a parseable blob.
func TestGetEDIDPresets(t *testing.T) {
	presets, err := rpcGetEDIDPresets()
	if err != nil {
		t.Fatalf("rpcGetEDIDPresets: %v", err)
	}
	if len(presets) != len(edidModeIDs) {
		t.Fatalf("got %d presets, want %d", len(presets), len(edidModeIDs))
	}
	for _, p := range presets {
		if p.EDIDHex == "" {
			t.Errorf("preset %q has no blob", p.ID)
		}
		if p.Label == "" {
			t.Errorf("preset %q has no label", p.ID)
		}
	}
}

func TestEDIDNameForCaps(t *testing.T) {
	cases := []struct {
		caps EDIDCaps
		want string
	}{
		{EDIDCaps{MaxRes: "1920x1080", Refresh: 60}, "KVM 1080p60"},
		{EDIDCaps{MaxRes: "1280x720", Refresh: 60}, "KVM 720p60"},
		{EDIDCaps{MaxRes: "1920x1200", Refresh: 60}, "KVM 1920x1200"},
		{EDIDCaps{}, "KVM"},
	}
	for _, c := range cases {
		if got := edidNameForCaps(c.caps); got != c.want {
			t.Errorf("edidNameForCaps(%+v) = %q, want %q", c.caps, got, c.want)
		}
	}
}

func TestSetEDIDMonitorName(t *testing.T) {
	blob, err := loadEDIDBlob("1080p60", false)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	out, err := setEDIDMonitorName(blob, "KVM custom")
	if err != nil {
		t.Fatalf("rename: %v", err)
	}
	// Must stay a structurally valid EDID (checksum recomputed).
	if err := validateEDID(out); err != nil {
		t.Fatalf("renamed blob invalid: %v", err)
	}
	b, err := hex.DecodeString(out)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !bytes.Contains(b, []byte("KVM custom")) {
		t.Error("renamed blob missing 'KVM custom'")
	}
}
