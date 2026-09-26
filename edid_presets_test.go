package kvm

import (
	"bytes"
	"encoding/hex"
	"testing"
)

// Every enabled preset must carry a structurally valid EDID (correct header +
// per-block checksum) and parse to a non-empty resolution — a malformed blob
// would break the captured target's EDID handshake.
func TestEDIDPresetsValid(t *testing.T) {
	for _, p := range edidPresets {
		if p.Disabled || p.EDIDHex == "" {
			continue
		}
		if err := validateEDID(p.EDIDHex); err != nil {
			t.Errorf("preset %q: invalid EDID: %v", p.ID, err)
		}
		caps, err := parseEDIDCaps(p.EDIDHex)
		if err != nil {
			t.Errorf("preset %q: parse caps: %v", p.ID, err)
			continue
		}
		if caps.MaxRes == "" || caps.Refresh == 0 {
			t.Errorf("preset %q: no resolution/refresh parsed (%+v)", p.ID, caps)
		}
	}
}

// Disabled presets must not carry a blob (they are placeholders for modes with no
// verified EDID yet).
func TestEDIDDisabledHaveNoBlob(t *testing.T) {
	for _, p := range edidPresets {
		if p.Disabled && p.EDIDHex != "" {
			t.Errorf("preset %q is disabled but carries a blob", p.ID)
		}
	}
}

// The shipped 1080p60 preset must parse to exactly 1920x1080 @ ~60Hz.
func TestEDID1080pParse(t *testing.T) {
	caps, err := parseEDIDCaps(edid1080p60)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if caps.MaxRes != "1920x1080" {
		t.Errorf("1080p60 resolution = %q, want 1920x1080", caps.MaxRes)
	}
	if caps.Refresh < 59 || caps.Refresh > 61 {
		t.Errorf("1080p60 refresh = %d, want ~60", caps.Refresh)
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
	// The stock 1080p blob ships with donor name "T749-fHD720".
	out, err := setEDIDMonitorName(edid1080p60, "KVM 1080p60")
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
	// The 0xFC descriptor text must now read the new name, and not the donor's.
	if !bytes.Contains(b, []byte("KVM 1080p60")) {
		t.Error("renamed blob missing 'KVM 1080p60'")
	}
	if bytes.Contains(b, []byte("T749")) {
		t.Error("renamed blob still carries donor name 'T749'")
	}
}
