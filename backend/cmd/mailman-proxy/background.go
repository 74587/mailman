package main

import (
	"io"
	"os"
	"os/exec"
	"path/filepath"

	"mailman/internal/localproxy"
)

func startBackgroundProcess(cfg localproxy.Config, logFile string) (int, error) {
	args := backgroundArgs(cfg, logFile)
	cmd := exec.Command(os.Args[0], args...)
	cmd.Env = append(os.Environ(), backgroundChildEnv+"=1")
	detachCommand(cmd)

	stdin, err := os.Open(os.DevNull)
	if err != nil {
		return 0, err
	}
	defer stdin.Close()
	cmd.Stdin = stdin

	stdout, stderr, closeOutputs, err := backgroundOutputs(logFile)
	if err != nil {
		return 0, err
	}
	defer closeOutputs()
	cmd.Stdout = stdout
	cmd.Stderr = stderr

	if err := cmd.Start(); err != nil {
		return 0, err
	}
	pid := cmd.Process.Pid
	if err := cmd.Process.Release(); err != nil {
		return 0, err
	}
	return pid, nil
}

func backgroundOutputs(logFile string) (io.Writer, io.Writer, func(), error) {
	if logFile == "" {
		output, err := os.OpenFile(os.DevNull, os.O_WRONLY, 0644)
		if err != nil {
			return nil, nil, nil, err
		}
		return output, output, func() { _ = output.Close() }, nil
	}

	absPath, err := filepath.Abs(logFile)
	if err != nil {
		return nil, nil, nil, err
	}
	if err := os.MkdirAll(filepath.Dir(absPath), 0755); err != nil {
		return nil, nil, nil, err
	}
	output, err := os.OpenFile(absPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return nil, nil, nil, err
	}
	return output, output, func() { _ = output.Close() }, nil
}
