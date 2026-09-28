package kvm

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"time"

	"kvm/internal/websecure"
)

const (
	tlsStorePath                     = "/userdata/picokvm/tls"
	webSecureListen                  = ":443"
	webSecureSelfSignedDefaultDomain = "kvm.local"
	webSecureSelfSignedCAName        = "KVM Self-Signed CA"
	webSecureSelfSignedOrganization  = "KVM"
	webSecureSelfSignedOU            = "KVM Self-Signed"
	webSecureCustomCertificateName   = "user-defined"
)

var (
	certStore  *websecure.CertStore
	certSigner *websecure.SelfSigner
)

type TLSState struct {
	Mode        string `json:"mode"`
	Certificate string `json:"certificate"`
	PrivateKey  string `json:"privateKey"`
	// Source applies when Mode=="custom": "pem" (pasted) or "tailscale" (auto-issued).
	Source string `json:"source,omitempty"`
	// Domain is read-only: the MagicDNS name used when Source=="tailscale".
	Domain string `json:"domain,omitempty"`
	// CommonName and NotAfter are read-only summary fields of the stored custom cert.
	CommonName string `json:"commonName,omitempty"`
	NotAfter   string `json:"notAfter,omitempty"` // RFC3339
	// Additional read-only parsed summary fields of the stored custom cert leaf.
	Issuer       string   `json:"issuer,omitempty"`
	NotBefore    string   `json:"notBefore,omitempty"` // RFC3339
	SANs         []string `json:"sans,omitempty"`
	SerialNumber string   `json:"serialNumber,omitempty"`
}

// TLSCertSummary is the parsed, cached readout of the stored custom cert leaf.
// Cached in config so getTLSState does not re-parse x509 on every call.
type TLSCertSummary struct {
	CommonName   string   `json:"common_name,omitempty"`
	NotAfter     string   `json:"not_after,omitempty"` // RFC3339
	Issuer       string   `json:"issuer,omitempty"`
	NotBefore    string   `json:"not_before,omitempty"` // RFC3339
	SANs         []string `json:"sans,omitempty"`
	SerialNumber string   `json:"serial_number,omitempty"`
}

// parseCertSummary parses a DER leaf into a cached summary. nil on failure.
func parseCertSummary(der []byte) *TLSCertSummary {
	leaf, err := x509.ParseCertificate(der)
	if err != nil {
		return nil
	}
	sum := &TLSCertSummary{
		CommonName: leaf.Subject.CommonName,
		NotAfter:   leaf.NotAfter.UTC().Format(time.RFC3339),
		Issuer:     leaf.Issuer.CommonName,
		NotBefore:  leaf.NotBefore.UTC().Format(time.RFC3339),
		SANs:       leaf.DNSNames,
	}
	if leaf.SerialNumber != nil {
		sum.SerialNumber = leaf.SerialNumber.String()
	}
	return sum
}

func initCertStore() {
	if certStore != nil {
		websecureLogger.Warn().Msg("TLS store already initialized, it should not be initialized again")
		return
	}
	certStore = websecure.NewCertStore(tlsStorePath, websecureLogger)
	certStore.LoadCertificates()

	certSigner = websecure.NewSelfSigner(
		certStore,
		websecureLogger,
		webSecureSelfSignedDefaultDomain,
		webSecureSelfSignedOrganization,
		webSecureSelfSignedOU,
		webSecureSelfSignedCAName,
	)
}

func getCertificate(info *tls.ClientHelloInfo) (*tls.Certificate, error) {
	switch config.TLSMode {
	case "self-signed":
		if isTimeSyncNeeded() || !timeSync.IsSyncSuccess() {
			return nil, fmt.Errorf("time is not synced")
		}
		return certSigner.GetCertificate(info)
	case "custom":
		return certStore.GetCertificate(webSecureCustomCertificateName), nil
	}

	websecureLogger.Info().Msg("TLS mode is disabled but WebSecure is running, returning nil")
	return nil, nil
}

func getTLSState() TLSState {
	s := TLSState{}
	switch config.TLSMode {
	case "disabled":
		s.Mode = "disabled"
	case "custom":
		s.Mode = "custom"
		s.Source = config.TLSCustomSource
		if s.Source == "" {
			s.Source = tlsCustomSourcePEM
		}
		if s.Source == tlsCustomSourceTailscale {
			// best-effort; empty when tailscale is down
			if dnsName, err := tailscaleSelfDNSName(); err == nil {
				s.Domain = dnsName
			}
		}
		cert := certStore.GetCertificate(webSecureCustomCertificateName)
		if cert != nil {
			var certPEM []byte
			// convert to pem format
			for _, c := range cert.Certificate {
				block := pem.Block{
					Type:  "CERTIFICATE",
					Bytes: c,
				}

				certPEM = append(certPEM, pem.EncodeToMemory(&block)...)
			}
			s.Certificate = string(certPEM)

			// Use the cached summary; parse once (first time / after cache cleared)
			// and persist so later getTLSState calls skip x509 parsing.
			if config.TLSCertSummary == nil && len(cert.Certificate) > 0 {
				if sum := parseCertSummary(cert.Certificate[0]); sum != nil {
					config.TLSCertSummary = sum
					if err := SaveConfig(); err != nil {
						websecureLogger.Warn().Err(err).Msg("failed to persist TLS cert summary cache")
					}
				}
			}
			if sum := config.TLSCertSummary; sum != nil {
				s.CommonName = sum.CommonName
				s.NotAfter = sum.NotAfter
				s.Issuer = sum.Issuer
				s.NotBefore = sum.NotBefore
				s.SANs = sum.SANs
				s.SerialNumber = sum.SerialNumber
			}
		}
	case "self-signed":
		s.Mode = "self-signed"
	default:
		s.Mode = "disabled"
	}

	return s
}

func setTLSState(s TLSState) error {
	var isChanged = false

	switch s.Mode {
	case "disabled":
		if config.TLSMode != "" {
			isChanged = true
		}
		config.TLSMode = ""
		config.TLSCertSummary = nil
	case "custom":
		if config.TLSMode == "" {
			isChanged = true
		}
		switch s.Source {
		case tlsCustomSourceTailscale:
			// Issue via tailscale CLI and store under the custom cert.
			// Gates on an active tailscale connection.
			if err := issueTailscaleCert(); err != nil {
				return fmt.Errorf("failed to issue tailscale certificate: %w", err)
			}
			config.TLSCustomSource = tlsCustomSourceTailscale
			config.TLSCertSummary = nil // new cert issued; re-parse on next read
			startTailscaleCertRenewal()
		default:
			// parse pem to cert and key
			err, _ := certStore.ValidateAndSaveCertificate(webSecureCustomCertificateName, s.Certificate, s.PrivateKey, true)
			// warn doesn't matter as ... we don't know the hostname yet
			if err != nil {
				return fmt.Errorf("failed to save certificate: %w", err)
			}
			config.TLSCustomSource = tlsCustomSourcePEM
			config.TLSCertSummary = nil // new cert uploaded; re-parse on next read
		}
		config.TLSMode = "custom"
	case "self-signed":
		if config.TLSMode == "" {
			isChanged = true
		}
		config.TLSMode = "self-signed"
	default:
		return fmt.Errorf("invalid TLS mode: %s", s.Mode)
	}

	if !isChanged {
		websecureLogger.Info().Msg("TLS enabled state is not changed, not starting/stopping websecure server")
		return nil
	}

	if err := SaveConfig(); err != nil {
		return fmt.Errorf("failed to save TLS config: %w", err)
	}

	if config.TLSMode == "" {
		websecureLogger.Info().Msg("Stopping websecure server, as TLS mode is disabled")
		stopWebSecureServer()
	} else {
		websecureLogger.Info().Msg("Starting websecure server, as TLS mode is enabled")
		startWebSecureServer()
	}

	return nil
}

var (
	startTLS       = make(chan struct{})
	stopTLS        = make(chan struct{})
	tlsServiceLock = sync.Mutex{}
	tlsStarted     = false
)

// RunWebSecureServer runs a web server with TLS.
func runWebSecureServer() {
	tlsServiceLock.Lock()
	defer tlsServiceLock.Unlock()

	tlsStarted = true
	defer func() {
		tlsStarted = false
	}()

	r := setupRouter()

	server := &http.Server{
		Addr:    webSecureListen,
		Handler: r,
		TLSConfig: &tls.Config{
			MaxVersion:       tls.VersionTLS13,
			CurvePreferences: []tls.CurveID{},
			GetCertificate:   getCertificate,
		},
	}
	websecureLogger.Info().Str("listen", webSecureListen).Msg("Starting websecure server")

	go func() {
		for range stopTLS {
			websecureLogger.Info().Msg("Shutting down websecure server")
			err := server.Shutdown(context.Background())
			if err != nil {
				websecureLogger.Error().Err(err).Msg("failed to shutdown websecure server")
			}
		}
	}()

	err := server.ListenAndServeTLS("", "")
	if !errors.Is(err, http.ErrServerClosed) {
		panic(err)
	}
}

func stopWebSecureServer() {
	if !tlsStarted {
		websecureLogger.Info().Msg("Websecure server is not running, not stopping it")
		return
	}
	stopTLS <- struct{}{}
}

func startWebSecureServer() {
	if tlsStarted {
		websecureLogger.Info().Msg("Websecure server is already running, not starting it again")
		return
	}
	startTLS <- struct{}{}
}

func RunWebSecureServer() {
	// Initialize cert store eagerly so setTLSState can be called
	// via JSON-RPC even when TLS server has not started yet.
	initCertStore()

	// Resume tailscale cert auto-renewal across reboots.
	if config.TLSMode == "custom" && config.TLSCustomSource == tlsCustomSourceTailscale {
		startTailscaleCertRenewal()
	}

	for range startTLS {
		websecureLogger.Info().Msg("Starting websecure server, as we have received a start signal")
		go runWebSecureServer()
	}
}
