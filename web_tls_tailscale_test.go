package kvm

import "testing"

func TestParseTailscaleSelf(t *testing.T) {
	tests := []struct {
		name        string
		json        string
		wantDNSName string
		wantRunning bool
		wantErr     bool
	}{
		{
			name:        "running with trailing dot stripped",
			json:        `{"BackendState":"Running","Self":{"DNSName":"picokvm-lite.tail018dd0.ts.net."}}`,
			wantDNSName: "picokvm-lite.tail018dd0.ts.net",
			wantRunning: true,
		},
		{
			name:        "not running",
			json:        `{"BackendState":"Stopped","Self":{"DNSName":"picokvm-lite.tail018dd0.ts.net."}}`,
			wantDNSName: "picokvm-lite.tail018dd0.ts.net",
			wantRunning: false,
		},
		{
			name:        "no trailing dot",
			json:        `{"BackendState":"Running","Self":{"DNSName":"mimi.tail018dd0.ts.net"}}`,
			wantDNSName: "mimi.tail018dd0.ts.net",
			wantRunning: true,
		},
		{
			name:    "empty dnsname errors",
			json:    `{"BackendState":"Running","Self":{"DNSName":""}}`,
			wantErr: true,
		},
		{
			name:    "invalid json errors",
			json:    `not json`,
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dnsName, running, err := parseTailscaleSelf([]byte(tt.json))
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if dnsName != tt.wantDNSName {
				t.Errorf("dnsName = %q, want %q", dnsName, tt.wantDNSName)
			}
			if running != tt.wantRunning {
				t.Errorf("running = %v, want %v", running, tt.wantRunning)
			}
		})
	}
}
