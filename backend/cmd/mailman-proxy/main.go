package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"mailman/internal/localproxy"
)

const backgroundChildEnv = "MAILMAN_PROXY_BACKGROUND_CHILD"

func main() {
	cfg, background, daemon, logFile := parseFlags(os.Args[1:])
	runInBackground := background || daemon

	if runInBackground && os.Getenv(backgroundChildEnv) != "1" {
		pid, err := startBackgroundProcess(cfg, logFile)
		if err != nil {
			log.Fatalf("后台启动失败: %v", err)
		}
		fmt.Printf("Mailman proxy 已在后台启动，PID: %d\n", pid)
		if logFile != "" {
			fmt.Printf("日志文件: %s\n", logFile)
		}
		return
	}

	logger, cleanup, err := newLogger(cfg.LogRequests, logFile)
	if err != nil {
		log.Fatalf("初始化日志失败: %v", err)
	}
	defer cleanup()

	if err := cfg.Validate(); err != nil {
		log.Fatalf("配置错误: %v", err)
	}

	server, err := localproxy.NewServer(cfg, logger)
	if err != nil {
		log.Fatalf("创建代理失败: %v", err)
	}

	errCh := make(chan error, 1)
	go func() {
		if logger != nil {
			logger.Printf("Mailman proxy listening on http://%s, forwarding to %s", cfg.Addr(), cfg.Target)
		}
		errCh <- server.ListenAndServe()
	}()

	stopCh := make(chan os.Signal, 1)
	signal.Notify(stopCh, os.Interrupt, syscall.SIGTERM)

	select {
	case sig := <-stopCh:
		if logger != nil {
			logger.Printf("收到退出信号: %s", sig)
		}
	case err := <-errCh:
		if !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("代理服务退出: %v", err)
		}
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		log.Fatalf("代理服务关闭失败: %v", err)
	}
	if logger != nil {
		logger.Printf("Mailman proxy 已关闭")
	}
}

func parseFlags(args []string) (localproxy.Config, bool, bool, string) {
	defaults := localproxy.DefaultConfig()
	fs := flag.NewFlagSet("mailman-proxy", flag.ExitOnError)

	listenIP := envString("MAILMAN_PROXY_LISTEN_IP", defaults.ListenIP)
	port := envInt("MAILMAN_PROXY_PORT", defaults.Port)
	target := envString("MAILMAN_PROXY_TARGET", defaults.Target)
	logRequests := envBool("MAILMAN_PROXY_LOG", defaults.LogRequests)
	verbose := envBool("MAILMAN_PROXY_VERBOSE", false)
	timeout := envDuration("MAILMAN_PROXY_TIMEOUT", defaults.Timeout)
	background := false
	daemon := false
	logFile := envString("MAILMAN_PROXY_LOG_FILE", "")

	fs.StringVar(&listenIP, "listen-ip", listenIP, "监听 IP")
	fs.StringVar(&listenIP, "i", listenIP, "监听 IP（listen-ip 的缩写）")
	fs.IntVar(&port, "port", port, "监听端口")
	fs.IntVar(&port, "p", port, "监听端口（port 的缩写）")
	fs.StringVar(&target, "target", target, "转发目标域名或 URL，例如 https://mailman.easycat.io")
	fs.StringVar(&target, "t", target, "转发目标域名或 URL（target 的缩写）")
	fs.BoolVar(&logRequests, "log", logRequests, "是否展示请求日志")
	fs.BoolVar(&logRequests, "l", logRequests, "是否展示请求日志（log 的缩写）")
	fs.BoolVar(&verbose, "verbose", verbose, "展示更详细的转发日志")
	fs.BoolVar(&verbose, "v", verbose, "展示更详细的转发日志（verbose 的缩写）")
	fs.DurationVar(&timeout, "timeout", timeout, "目标服务响应头超时时间")
	fs.DurationVar(&timeout, "T", timeout, "目标服务响应头超时时间（timeout 的缩写）")
	fs.BoolVar(&background, "background", background, "后台运行")
	fs.BoolVar(&background, "b", background, "后台运行（background 的缩写）")
	fs.BoolVar(&daemon, "daemon", daemon, "后台运行（background 的别名）")
	fs.BoolVar(&daemon, "d", daemon, "后台运行（daemon 的缩写）")
	fs.StringVar(&logFile, "log-file", logFile, "日志文件路径；后台运行时默认写入当前目录 mailman-proxy.log")
	fs.StringVar(&logFile, "o", logFile, "日志文件路径（log-file 的缩写）")

	fs.Usage = func() {
		fmt.Fprintf(fs.Output(), "Mailman local callback proxy\n\n")
		fmt.Fprintf(fs.Output(), "Usage:\n")
		fmt.Fprintf(fs.Output(), "  mailman-proxy -port=8080 -target=https://mailman.easycat.io\n")
		fmt.Fprintf(fs.Output(), "  mailman-proxy -p=8080 -t=mailman.easycat.io\n")
		fmt.Fprintf(fs.Output(), "  mailman-proxy -i=0.0.0.0 -p=8080 -t=mailman.easycat.io -b\n\n")
		fmt.Fprintf(fs.Output(), "Options:\n")
		fs.PrintDefaults()
	}

	if err := fs.Parse(args); err != nil {
		os.Exit(2)
	}

	if (background || daemon) && strings.TrimSpace(logFile) == "" {
		logFile = "mailman-proxy.log"
	}

	cfg := localproxy.Config{
		ListenIP:    listenIP,
		Port:        port,
		Target:      target,
		LogRequests: logRequests,
		Verbose:     verbose,
		Timeout:     timeout,
	}
	return cfg, background, daemon, logFile
}

func backgroundArgs(cfg localproxy.Config, logFile string) []string {
	return []string{
		"-listen-ip", cfg.ListenIP,
		"-port", strconv.Itoa(cfg.Port),
		"-target", cfg.Target,
		"-log", strconv.FormatBool(cfg.LogRequests),
		"-verbose", strconv.FormatBool(cfg.Verbose),
		"-timeout", cfg.Timeout.String(),
		"-log-file", logFile,
	}
}

func newLogger(enabled bool, logFile string) (*log.Logger, func(), error) {
	if !enabled && logFile == "" {
		return nil, func() {}, nil
	}

	var output io.Writer = os.Stdout
	var file *os.File
	if logFile != "" {
		absPath, err := filepath.Abs(logFile)
		if err != nil {
			return nil, nil, err
		}
		if err := os.MkdirAll(filepath.Dir(absPath), 0755); err != nil {
			return nil, nil, err
		}
		file, err = os.OpenFile(absPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
		if err != nil {
			return nil, nil, err
		}
		output = file
	}

	cleanup := func() {
		if file != nil {
			_ = file.Close()
		}
	}
	return log.New(output, "", log.LstdFlags), cleanup, nil
}

func envString(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

func envBool(name string, fallback bool) bool {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func envInt(name string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func envDuration(name string, fallback time.Duration) time.Duration {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	parsed, err := time.ParseDuration(value)
	if err != nil {
		return fallback
	}
	return parsed
}
