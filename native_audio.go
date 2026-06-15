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
	audioCmd     *exec.Cmd
	audioCmdLock = &sync.Mutex{}
)

var audioSocketConn net.Conn

var audioOngoingRequests = make(map[int32]chan *CtrlResponse)

var audioLock = &sync.Mutex{}

func CallAudioCtrlAction(action string, params map[string]interface{}) (*CtrlResponse, error) {
	audioLock.Lock()
	defer audioLock.Unlock()
	ctrlAction := CtrlAction{
		Action: action,
		Seq:    seq,
		Params: params,
	}

	responseChan := make(chan *CtrlResponse)
	audioOngoingRequests[seq] = responseChan
	seq++

	jsonData, err := json.Marshal(ctrlAction)
	if err != nil {
		delete(audioOngoingRequests, ctrlAction.Seq)
		return nil, fmt.Errorf("error marshaling ctrl action: %w", err)
	}

	scopedLogger := audioLogger.With().
		Str("action", ctrlAction.Action).
		Interface("params", ctrlAction.Params).Logger()

	scopedLogger.Debug().Msg("sending audio ctrl action")

	err = WriteAudioCtrlMessage(jsonData)
	if err != nil {
		delete(audioOngoingRequests, ctrlAction.Seq)
		return nil, ErrorfL(&scopedLogger, "error writing audio ctrl message", err)
	}

	select {
	case response := <-responseChan:
		delete(audioOngoingRequests, seq)
		if response.Error != "" {
			return nil, ErrorfL(
				&scopedLogger,
				"error audio response: %s",
				errors.New(response.Error),
			)
		}
		return response, nil
	case <-time.After(5 * time.Second):
		close(responseChan)
		delete(audioOngoingRequests, seq)
		return nil, ErrorfL(&scopedLogger, "timeout waiting for response", nil)
	}
}

func WriteAudioCtrlMessage(message []byte) error {
	if audioSocketConn == nil {
		return fmt.Errorf("audio socket not connected")
	}
	_, err := audioSocketConn.Write(message)
	return err
}

var audioCtrlSocketListener net.Listener

var audioCtrlClientConnected = make(chan struct{})
var audioCtrlClientOnce sync.Once

func waitAudioCtrlClientConnected() {
	<-audioCtrlClientConnected
}

func StartAudioSocketServer(socketPath string, handleClient func(net.Conn), isCtrl bool) (net.Listener, error) {
	scopedLogger := audioLogger.With().
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
				audioCtrlClientOnce.Do(func() {
					close(audioCtrlClientConnected)
					scopedLogger.Debug().Msg("first audio ctrl socket client connected")
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

var audioStarted sync.Once

func StartAudioCtrlSocketServer() error {
	listener, err := StartAudioSocketServer("/var/run/kvm_audio.sock", handleAudioCtrlClient, true)
	if err != nil {
		return err
	}
	audioCtrlSocketListener = listener
	audioLogger.Debug().Msg("audio ctrl sock started")
	return nil
}

func handleAudioCtrlClient(conn net.Conn) {
	defer conn.Close()

	scopedLogger := audioLogger.With().
		Str("addr", conn.RemoteAddr().String()).
		Str("type", "audio_ctrl").
		Logger()

	scopedLogger.Info().Msg("audio socket client connected")
	if audioSocketConn != nil {
		scopedLogger.Debug().Msg("closing existing audio socket connection")
		audioSocketConn.Close()
	}

	audioSocketConn = conn

	readBuf := make([]byte, 4096)
	for {
		n, err := conn.Read(readBuf)
		if err != nil {
			scopedLogger.Warn().Err(err).Msg("error reading from audio sock")
			break
		}
		readMsg := string(readBuf[:n])

		audioResp := CtrlResponse{}
		err = json.Unmarshal([]byte(readMsg), &audioResp)
		if err != nil {
			scopedLogger.Warn().Err(err).Str("data", readMsg).Msg("error parsing audio sock msg")
			continue
		}
		scopedLogger.Trace().Interface("data", audioResp).Msg("audio sock msg")

		if audioResp.Seq != 0 {
			responseChan, ok := audioOngoingRequests[audioResp.Seq]
			if ok {
				responseChan <- &audioResp
			}
		}
		switch audioResp.Event {
		case "audio_input_state":
			HandleAudioStateMessage(audioResp)
		}
	}

	scopedLogger.Debug().Msg("audio sock disconnected")
}

// killStaleAudioProcesses finds and kills any existing kvm_audio processes
// that may have been left behind by a previous kvm_app instance. This prevents
// zombie processes from accumulating on the memory-constrained device.
func killStaleAudioProcesses() {
	binaryName := "kvm_audio"

	// Read /proc to find matching processes (more reliable than pkill on embedded systems)
	entries, err := os.ReadDir("/proc")
	if err != nil {
		audioLogger.Warn().Err(err).Msg("failed to read /proc for zombie detection")
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
			continue // not a PID directory
		}

		// Read the process comm (basename of executable)
		commBytes, err := os.ReadFile(fmt.Sprintf("/proc/%d/comm", pid))
		if err != nil {
			continue // process may have already exited
		}
		comm := strings.TrimSpace(string(commBytes))
		if comm != binaryName {
			continue
		}

		// Don't kill ourselves or our own tracked child
		if pid == ourPid {
			continue
		}
		audioCmdLock.Lock()
		isOurChild := audioCmd != nil && audioCmd.Process != nil && audioCmd.Process.Pid == pid
		audioCmdLock.Unlock()
		if isOurChild {
			continue
		}

		// Check process state — look for zombies (state Z) and running processes
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

		audioLogger.Info().
			Int("pid", pid).
			Str("state", state).
			Msg("killing stale kvm_audio process")

		proc, err := os.FindProcess(pid)
		if err != nil {
			continue
		}
		_ = proc.Kill()
		// Wait to reap the zombie
		_, _ = proc.Wait()
		killed++
	}

	if killed > 0 {
		audioLogger.Info().Int("count", killed).Msg("cleaned up stale kvm_audio processes")
		// Brief pause to let the OS fully clean up
		time.Sleep(500 * time.Millisecond)
	}
}

func startAudioBinaryWithLock(binaryPath string) (*exec.Cmd, error) {
	audioCmdLock.Lock()
	defer audioCmdLock.Unlock()

	cmd, err := startAudioBinary(binaryPath)
	if err != nil {
		return nil, err
	}
	audioCmd = cmd
	return cmd, nil
}

func superviseAudioBinary(binaryPath string) error {
	audioCmdLock.Lock()
	cmd := audioCmd
	audioCmdLock.Unlock()

	if cmd == nil || cmd.Process == nil {
		// No tracked process — kill any stale ones and restart
		killStaleAudioProcesses()
		return restartAudioBinary(binaryPath)
	}

	// Wait blocks until the process exits — does NOT hold the lock
	err := cmd.Wait()

	if err == nil {
		audioLogger.Info().Msg("kvm_audio binary exited cleanly")
	} else if exiterr, ok := err.(*exec.ExitError); ok {
		audioLogger.Warn().Int("exit_code", exiterr.ExitCode()).Msg("kvm_audio binary exited with error")
	} else {
		audioLogger.Warn().Err(err).Msg("kvm_audio binary exited with unknown error")
	}

	// Clean up any zombie children before restarting
	killStaleAudioProcesses()
	return restartAudioBinary(binaryPath)
}

func restartAudioBinary(binaryPath string) error {
	// Check if we should stop
	select {
	case <-appCtx.Done():
		return nil
	default:
	}

	audioLogger.Info().Msg("restarting kvm_audio binary in 10s")
	select {
	case <-time.After(10 * time.Second):
	case <-appCtx.Done():
		return nil
	}

	audioCmdLock.Lock()
	defer audioCmdLock.Unlock()

	cmd, err := startAudioBinary(binaryPath)
	if err != nil {
		audioLogger.Warn().Err(err).Msg("failed to restart binary")
		return err
	}
	audioCmd = cmd
	audioLogger.Info().Int("pid", cmd.Process.Pid).Msg("kvm_audio binary restarted")
	return nil
}

func ExtractAndRunAudioBin() error {
	binaryPath := "/userdata/picokvm/bin/kvm_audio"

	// Make the binary executable
	if err := os.Chmod(binaryPath, 0755); err != nil {
		return fmt.Errorf("failed to make binary executable: %w", err)
	}

	// Kill any stale kvm_audio processes from previous runs
	killStaleAudioProcesses()

	// Run the binary in the background
	cmd, err := startAudioBinaryWithLock(binaryPath)
	if err != nil {
		return fmt.Errorf("failed to start binary: %w", err)
	}

	// Supervisor goroutine — restarts on crash, respects appCtx
	go func() {
		for {
			select {
			case <-appCtx.Done():
				audioLogger.Info().Msg("stopping audio binary supervisor")
				return
			default:
				err := superviseAudioBinary(binaryPath)
				if err != nil {
					audioLogger.Warn().Err(err).Msg("failed to supervise audio binary")
					// Wait before retrying, but respect cancellation
					select {
					case <-time.After(1 * time.Second):
					case <-appCtx.Done():
						return
					}
				}
			}
		}
	}()

	// Kill the process when app shuts down
	go func() {
		<-appCtx.Done()
		audioCmdLock.Lock()
		cmd := audioCmd
		audioCmdLock.Unlock()
		if cmd != nil && cmd.Process != nil {
			audioLogger.Info().Int("pid", cmd.Process.Pid).Msg("killing kvm_audio on shutdown")
			_ = cmd.Process.Kill()
		}
	}()

	audioLogger.Info().Int("pid", cmd.Process.Pid).Msg("kvm_audio binary started")

	return nil
}
