//go:build linux

package kvm

import (
	"os/exec"
	"time"

	"golang.org/x/sys/unix"
)

func rebootSystem() {
	unix.Sync()
	time.Sleep(200 * time.Millisecond)

	if err := unix.Reboot(unix.LINUX_REBOOT_CMD_RESTART); err != nil {
		keysLogger.Error().Err(err).Msg("syscall reboot failed, trying /sbin/reboot")
		_ = exec.Command("/sbin/reboot", "-f").Run()
		_ = exec.Command("reboot", "-f").Run()
	}
}
