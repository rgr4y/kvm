//go:build !linux

package udhcpc

import (
	"fmt"

	"github.com/rs/zerolog"
)

type DHCPClient struct {
	onLeaseChange func(lease *Lease)
}

type DHCPClientOptions struct {
	InterfaceName  string
	PidFile        string
	Logger         *zerolog.Logger
	OnLeaseChange  func(lease *Lease)
	RequestAddress string
}

func NewDHCPClient(options *DHCPClientOptions) *DHCPClient {
	return &DHCPClient{onLeaseChange: options.OnLeaseChange}
}

func (c *DHCPClient) GetLease() *Lease {
	return nil
}

func (c *DHCPClient) RequestAddress(string) error {
	return fmt.Errorf("udhcpc is not supported on this platform")
}

func (c *DHCPClient) Renew() error {
	return fmt.Errorf("udhcpc is not supported on this platform")
}

func (c *DHCPClient) Release() error {
	return fmt.Errorf("udhcpc is not supported on this platform")
}

func (c *DHCPClient) SetEnabled(bool) {}
