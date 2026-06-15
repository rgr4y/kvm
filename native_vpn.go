package kvm

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"
)

var (
	vpnCmd     *exec.Cmd
	vpnCmdLock = &sync.Mutex{}
)

var vpnSocketConn net.Conn

var vpnOngoingRequests = make(map[int32]chan *CtrlResponse)

var vpnLock = &sync.Mutex{}

func CallVpnCtrlAction(action string, params map[string]interface{}) (*CtrlResponse, error) {
	// Start VPN binary on-demand if not already running
	if err := EnsureVpnRunning(); err != nil {
		return nil, fmt.Errorf("failed to ensure vpn is running: %w", err)
	}

	vpnLock.Lock()
	defer vpnLock.Unlock()
	ctrlAction := CtrlAction{
		Action: action,
		Seq:    seq,
		Params: params,
	}

	responseChan := make(chan *CtrlResponse)
	vpnOngoingRequests[seq] = responseChan
	seq++

	jsonData, err := json.Marshal(ctrlAction)
	if err != nil {
		delete(vpnOngoingRequests, ctrlAction.Seq)
		return nil, fmt.Errorf("error marshaling ctrl action: %w", err)
	}

	scopedLogger := vpnLogger.With().
		Str("action", ctrlAction.Action).
		Interface("params", ctrlAction.Params).Logger()

	scopedLogger.Debug().Msg("sending vpn ctrl action")

	err = WriteVpnCtrlMessage(jsonData)
	if err != nil {
		delete(vpnOngoingRequests, ctrlAction.Seq)
		return nil, ErrorfL(&scopedLogger, "error writing vpn ctrl message", err)
	}

	select {
	case response := <-responseChan:
		delete(vpnOngoingRequests, seq)
		if response.Error != "" {
			return nil, ErrorfL(
				&scopedLogger,
				"error vpn response: %s",
				errors.New(response.Error),
			)
		}
		return response, nil
	case <-time.After(10 * time.Second):
		close(responseChan)
		delete(vpnOngoingRequests, seq)
		return nil, ErrorfL(&scopedLogger, "timeout waiting for response", nil)
	}
}

func WriteVpnCtrlMessage(message []byte) error {
	if vpnSocketConn == nil {
		return fmt.Errorf("vpn socket not connected")
	}
	_, err := vpnSocketConn.Write(message)
	return err
}

var vpnCtrlSocketListener net.Listener

var vpnCtrlClientConnected = make(chan struct{})
var vpnCtrlClientOnce sync.Once

func waitVpnCtrlClientConnected() {
	<-vpnCtrlClientConnected
}

func StartVpnSocketServer(socketPath string, handleClient func(net.Conn), isCtrl bool) (net.Listener, error) {
	scopedLogger := vpnLogger.With().
		Str("socket_path", socketPath).
		Logger()

	// Remove the socket file if it already exists
	if _, err := os.Stat(socketPath); err == nil {
		if err := os.Remove(socketPath); err != nil {
			return nil, fmt.Errorf("failed to remove existing socket file %s: %w", socketPath, err)
		}
	}

	listener, err := net.Listen("unixpacket", socketPath)
	if err != nil {
		return nil, fmt.Errorf("failed to listen on %s: %w", socketPath, err)
	}

	scopedLogger.Info().Msg("server listening")

	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				// Check if listener was closed (shutdown)
				select {
				case <-appCtx.Done():
					return
				default:
				}
				scopedLogger.Warn().Err(err).Msg("failed to accept socket")
				continue
			}
			if isCtrl {
				vpnCtrlClientOnce.Do(func() {
					close(vpnCtrlClientConnected)
					scopedLogger.Debug().Msg("first vpn ctrl socket client connected")
				})
			}

			go handleClient(conn)
		}
	}()

	// Close listener on app shutdown
	go func() {
		<-appCtx.Done()
		listener.Close()
	}()

	return listener, nil
}

func StartVpnCtrlSocketServer() error {
	listener, err := StartVpnSocketServer("/var/run/kvm_vpn.sock", handleVpnCtrlClient, true)
	if err != nil {
		return err
	}
	vpnCtrlSocketListener = listener
	vpnLogger.Debug().Msg("vpn ctrl sock started")
	return nil
}

func handleVpnCtrlClient(conn net.Conn) {
	defer conn.Close()

	scopedLogger := vpnLogger.With().
		Str("addr", conn.RemoteAddr().String()).
		Str("type", "vpn_ctrl").
		Logger()

	scopedLogger.Info().Msg("vpn socket client connected")
	if vpnSocketConn != nil {
		scopedLogger.Debug().Msg("closing existing vpn socket connection")
		vpnSocketConn.Close()
	}

	vpnSocketConn = conn

	readBuf := make([]byte, 4096)
	for {
		n, err := conn.Read(readBuf)
		if err != nil {
			scopedLogger.Warn().Err(err).Msg("error reading from vpn sock")
			break
		}

		vpnResp := CtrlResponse{}
		err = json.Unmarshal(readBuf[:n], &vpnResp)
		if err != nil {
			scopedLogger.Warn().Err(err).Str("data", string(readBuf[:n])).Msg("error parsing vpn sock msg")
			continue
		}
		scopedLogger.Trace().Interface("data", vpnResp).Msg("vpn sock msg")

		if vpnResp.Seq != 0 {
			responseChan, ok := vpnOngoingRequests[vpnResp.Seq]
			if ok {
				responseChan <- &vpnResp
			}
		}
		switch vpnResp.Event {
		case "vpn_display_update":
			HandleVpnDisplayUpdateMessage(vpnResp)
		}
	}

	scopedLogger.Debug().Msg("vpn sock disconnected")
}

// killStaleVpnProcesses finds and kills any existing kvm_vpn processes
// left behind by a previous kvm_app instance.
func killStaleVpnProcesses() {
	binaryName := "kvm_vpn"

	entries, err := os.ReadDir("/proc")
	if err != nil {
		vpnLogger.Warn().Err(err).Msg("failed to read /proc for zombie detection")
		return
	}

	ourPid := os.Getpid()
	killed := 0

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		pid, err := strconv.Atoi(entry.Name())
		if err != nil {
			continue
		}

		commBytes, err := os.ReadFile(fmt.Sprintf("/proc/%d/comm", pid))
		if err != nil {
			continue
		}
		comm := strings.TrimSpace(string(commBytes))
		if comm != binaryName {
			continue
		}

		if pid == ourPid {
			continue
		}
		vpnCmdLock.Lock()
		isOurChild := vpnCmd != nil && vpnCmd.Process != nil && vpnCmd.Process.Pid == pid
		vpnCmdLock.Unlock()
		if isOurChild {
			continue
		}

		statusBytes, err := os.ReadFile(fmt.Sprintf("/proc/%d/status", pid))
		if err != nil {
			continue
		}
		state := "unknown"
		for _, line := range strings.Split(string(statusBytes), "\n") {
			if strings.HasPrefix(line, "State:") {
				state = strings.TrimSpace(strings.TrimPrefix(line, "State:"))
				break
			}
		}

		vpnLogger.Info().
			Int("pid", pid).
			Str("state", state).
			Msg("killing stale kvm_vpn process")

		proc, err := os.FindProcess(pid)
		if err != nil {
			continue
		}
		_ = proc.Kill()
		_, _ = proc.Wait()
		killed++
	}

	if killed > 0 {
		vpnLogger.Info().Int("count", killed).Msg("cleaned up stale kvm_vpn processes")
		time.Sleep(500 * time.Millisecond)
	}
}

func startVpnBinaryWithLock(binaryPath string) (*exec.Cmd, error) {
	vpnCmdLock.Lock()
	defer vpnCmdLock.Unlock()

	cmd, err := startVpnBinary(binaryPath)
	if err != nil {
		return nil, err
	}
	vpnCmd = cmd
	return cmd, nil
}

func superviseVpnBinary(binaryPath string) error {
	vpnCmdLock.Lock()
	cmd := vpnCmd
	vpnCmdLock.Unlock()

	if cmd == nil || cmd.Process == nil {
		killStaleVpnProcesses()
		return restartVpnBinary(binaryPath)
	}

	err := cmd.Wait()

	if err == nil {
		vpnLogger.Info().Msg("kvm_vpn binary exited cleanly")
	} else if exiterr, ok := err.(*exec.ExitError); ok {
		vpnLogger.Warn().Int("exit_code", exiterr.ExitCode()).Msg("kvm_vpn binary exited with error")
	} else {
		vpnLogger.Warn().Err(err).Msg("kvm_vpn binary exited with unknown error")
	}

	killStaleVpnProcesses()
	return restartVpnBinary(binaryPath)
}

func restartVpnBinary(binaryPath string) error {
	select {
	case <-appCtx.Done():
		return nil
	default:
	}

	vpnLogger.Info().Msg("restarting kvm_vpn binary in 10s")
	select {
	case <-time.After(10 * time.Second):
	case <-appCtx.Done():
		return nil
	}

	vpnCmdLock.Lock()
	defer vpnCmdLock.Unlock()

	cmd, err := startVpnBinary(binaryPath)
	if err != nil {
		vpnLogger.Warn().Err(err).Msg("failed to restart binary")
		return err
	}
	vpnCmd = cmd
	vpnLogger.Info().Int("pid", cmd.Process.Pid).Msg("kvm_vpn binary restarted")
	return nil
}

// vpnStarted ensures kvm_vpn binary + socket are started exactly once.
var vpnStarted sync.Once

// vpnNeedsRunning returns true if any VPN service has autostart enabled.
func vpnNeedsRunning() bool {
	return config.TailScaleAutoStart ||
		config.ZeroTierAutoStart ||
		config.FrpcAutoStart ||
		config.EasytierAutoStart ||
		config.VntAutoStart ||
		config.CloudflaredAutoStart ||
		config.WireguardAutoStart
}

// EnsureVpnRunning starts the VPN binary on-demand (once) if not already running.
// Safe to call from any RPC handler.
func EnsureVpnRunning() error {
	var startErr error
	vpnStarted.Do(func() {
		if err := StartVpnCtrlSocketServer(); err != nil {
			startErr = fmt.Errorf("failed to start vpn ctrl socket: %w", err)
			return
		}
		if err := ExtractAndRunVpnBin(); err != nil {
			startErr = fmt.Errorf("failed to start vpn binary: %w", err)
		}
	})
	return startErr
}

func ExtractAndRunVpnBin() error {
	binaryPath := "/userdata/picokvm/bin/kvm_vpn"

	if err := os.Chmod(binaryPath, 0755); err != nil {
		return fmt.Errorf("failed to make binary executable: %w", err)
	}

	killStaleVpnProcesses()

	cmd, err := startVpnBinaryWithLock(binaryPath)
	if err != nil {
		return fmt.Errorf("failed to start binary: %w", err)
	}

	// Supervisor goroutine
	go func() {
		for {
			select {
			case <-appCtx.Done():
				vpnLogger.Info().Msg("stopping vpn binary supervisor")
				return
			default:
				err := superviseVpnBinary(binaryPath)
				if err != nil {
					vpnLogger.Warn().Err(err).Msg("failed to supervise vpn binary")
					select {
					case <-time.After(1 * time.Second):
					case <-appCtx.Done():
						return
					}
				}
			}
		}
	}()

	// Kill on shutdown
	go func() {
		<-appCtx.Done()
		vpnCmdLock.Lock()
		cmd := vpnCmd
		vpnCmdLock.Unlock()
		if cmd != nil && cmd.Process != nil {
			vpnLogger.Info().Int("pid", cmd.Process.Pid).Msg("killing kvm_vpn on shutdown")
			_ = cmd.Process.Kill()
		}
	}()

	vpnLogger.Info().Int("pid", cmd.Process.Pid).Msg("kvm_vpn binary started")

	return nil
}
