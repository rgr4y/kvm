package kvm

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	tailscaleCertRenewInterval = 60 * 24 * time.Hour // TS certs live ~90d; renew at 60d
	tailscaleCertRetryInterval = time.Hour           // retry cadence while tailscale is down
	tlsCustomSourceTailscale   = "tailscale"
	tlsCustomSourcePEM         = "pem"
)

// tailscaleStatusJSON returns the raw output of `tailscale status --json`.
// Indirected through a var so it can be stubbed in tests.
var tailscaleStatusJSON = func() ([]byte, error) {
	cmd := exec.Command(resolveVpnToolBinary("tailscale", "tailscale"), "status", "--json")
	return cmd.Output()
}

// tailscaleIssueCertFiles runs `tailscale cert` writing PEM to crtPath/keyPath.
// Indirected through a var so it can be stubbed in tests.
var tailscaleIssueCertFiles = func(dnsName, crtPath, keyPath string) error {
	cmd := exec.Command(resolveVpnToolBinary("tailscale", "tailscale"),
		"cert", "--cert-file", crtPath, "--key-file", keyPath, dnsName)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("tailscale cert failed: %w: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

// parseTailscaleSelf extracts the device's fully-qualified MagicDNS name and
// whether the backend is connected, from `tailscale status --json` output.
// The trailing dot on DNSName is stripped.
func parseTailscaleSelf(data []byte) (dnsName string, running bool, err error) {
	var status struct {
		BackendState string `json:"BackendState"`
		Self         struct {
			DNSName string `json:"DNSName"`
		} `json:"Self"`
	}
	if err := json.Unmarshal(data, &status); err != nil {
		return "", false, fmt.Errorf("failed to parse tailscale status: %w", err)
	}
	dnsName = strings.TrimSuffix(status.Self.DNSName, ".")
	if dnsName == "" {
		return "", false, fmt.Errorf("tailscale status has no Self.DNSName")
	}
	return dnsName, status.BackendState == "Running", nil
}

// tailscaleSelfDNSName returns the device MagicDNS name, requiring an active
// (BackendState == "Running") tailscale connection. This is the connection gate.
func tailscaleSelfDNSName() (string, error) {
	out, err := tailscaleStatusJSON()
	if err != nil {
		return "", fmt.Errorf("tailscale not reachable: %w", err)
	}
	dnsName, running, err := parseTailscaleSelf(out)
	if err != nil {
		return "", err
	}
	if !running {
		return "", fmt.Errorf("tailscale is not connected")
	}
	return dnsName, nil
}

// issueTailscaleCert obtains a cert for the device MagicDNS name via the
// tailscale CLI and stores it under the existing custom ("user-defined") cert,
// so the running websecure server picks it up on the next handshake.
func issueTailscaleCert() error {
	if certStore == nil {
		return fmt.Errorf("cert store not initialized")
	}

	dnsName, err := tailscaleSelfDNSName()
	if err != nil {
		return err
	}

	tmpDir, err := os.MkdirTemp("", "tscert")
	if err != nil {
		return fmt.Errorf("failed to create temp dir: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	crtPath := filepath.Join(tmpDir, "cert.crt")
	keyPath := filepath.Join(tmpDir, "cert.key")

	if err := tailscaleIssueCertFiles(dnsName, crtPath, keyPath); err != nil {
		return err
	}

	certPEM, err := os.ReadFile(crtPath)
	if err != nil {
		return fmt.Errorf("failed to read issued cert: %w", err)
	}
	keyPEM, err := os.ReadFile(keyPath)
	if err != nil {
		return fmt.Errorf("failed to read issued key: %w", err)
	}

	if saveErr, warnErr := certStore.ValidateAndSaveCertificate(
		webSecureCustomCertificateName, string(certPEM), string(keyPEM), true,
	); saveErr != nil {
		return fmt.Errorf("failed to save tailscale certificate: %w", saveErr)
	} else if warnErr != nil {
		websecureLogger.Warn().Err(warnErr).Str("dnsName", dnsName).Msg("tailscale certificate hostname warning")
	}

	websecureLogger.Info().Str("dnsName", dnsName).Msg("issued and stored tailscale certificate")
	return nil
}

var tailscaleRenewOnce sync.Once

// startTailscaleCertRenewal starts the background renewal loop exactly once.
func startTailscaleCertRenewal() {
	tailscaleRenewOnce.Do(func() {
		go tailscaleCertRenewLoop()
	})
}

func tailscaleCertRenewLoop() {
	for {
		wait := tailscaleCertRenewInterval

		if config.TLSMode == "custom" && config.TLSCustomSource == tlsCustomSourceTailscale {
			if err := issueTailscaleCert(); err != nil {
				websecureLogger.Warn().Err(err).Dur("retry_after", tailscaleCertRetryInterval).Msg("tailscale cert renewal failed")
				wait = tailscaleCertRetryInterval
			}
		}

		select {
		case <-appCtx.Done():
			return
		case <-time.After(wait):
		}
	}
}
