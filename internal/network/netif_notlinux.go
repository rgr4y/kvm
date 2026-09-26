//go:build !linux

package network

import (
	"fmt"

	"github.com/vishvananda/netlink"
)

func (s *NetworkInterfaceState) HandleLinkUpdate() error {
	return fmt.Errorf("not implemented")
}

func (s *NetworkInterfaceState) Run() error {
	return fmt.Errorf("not implemented")
}

func netlinkAddrs(iface netlink.Link) ([]netlink.Addr, error) {
	return nil, fmt.Errorf("not implemented")
}

func routeListIPv4(netlink.Link) ([]netlink.Route, error) {
	return nil, fmt.Errorf("not implemented")
}
