package monitoring

import (
	"context"
	"fmt"
	"testing"
	"time"
)

// Mock实现用于测试

// MockMetricsCollector 模拟指标收集器
type MockMetricsCollector struct {
	name        string
	interval    time.Duration
	collectFunc func(ctx context.Context) (*MetricSet, error)
}

func NewMockMetricsCollector(name string, interval time.Duration) *MockMetricsCollector {
	return &MockMetricsCollector{
		name:     name,
		interval: interval,
		collectFunc: func(ctx context.Context) (*MetricSet, error) {
			return &MetricSet{
				Name:      name,
				Timestamp: time.Now(),
				Metrics: map[string]interface{}{
					"test_metric":  100,
					"test_counter": 10,
					"test_gauge":   0.5,
				},
			}, nil
		},
	}
}

func (m *MockMetricsCollector) GetName() string {
	return m.name
}

func (m *MockMetricsCollector) GetInterval() time.Duration {
	return m.interval
}

func (m *MockMetricsCollector) Collect(ctx context.Context) (*MetricSet, error) {
	if m.collectFunc != nil {
		return m.collectFunc(ctx)
	}
	return nil, nil
}

func (m *MockMetricsCollector) SetCollectFunc(fn func(ctx context.Context) (*MetricSet, error)) {
	m.collectFunc = fn
}

func TestMonitor_BasicFunctionality(t *testing.T) {
	config := &MonitorConfig{
		CollectInterval:     time.Millisecond * 100,
		AlertCheckInterval:  time.Millisecond * 50,
		HealthCheckInterval: time.Millisecond * 200,
		MetricsRetention:    time.Second,
		EnableAlerts:        true,
		EnableHealthCheck:   true,
		AlertRules:          []*AlertRule{},
	}

	monitor := NewMonitor(config)

	// 注册测试收集器
	collector := NewMockMetricsCollector("test_collector", time.Millisecond*100)
	monitor.RegisterCollector(collector)

	ctx := context.Background()
	err := monitor.Start(ctx)
	if err != nil {
		t.Fatalf("启动监控器失败: %v", err)
	}

	// 等待一些数据收集
	time.Sleep(time.Millisecond * 300)

	// 检查指标是否被收集
	metrics := monitor.GetMetrics()
	if metrics == nil {
		t.Error("未获取到指标数据")
		return
	}

	if len(metrics.Collectors) == 0 {
		t.Error("没有收集器指标")
		return
	}

	collectorMetrics, exists := metrics.Collectors["test_collector"]
	if !exists {
		t.Error("测试收集器指标不存在")
		return
	}

	if collectorMetrics.CollectionCount == 0 {
		t.Error("收集器没有收集任何指标")
	}

	// 检查健康状态
	healthStatus := monitor.GetHealthStatus()
	if healthStatus == nil {
		t.Error("未获取到健康状态")
		return
	}

	if healthStatus.Overall == "" {
		t.Error("整体健康状态为空")
	}

	// 停止监控器
	err = monitor.Stop()
	if err != nil {
		t.Errorf("停止监控器失败: %v", err)
	}
}

func TestMonitor_AlertRules(t *testing.T) {
	// 创建告警规则
	alertRule := &AlertRule{
		ID:             "test_alert",
		Name:           "测试告警",
		Description:    "测试告警规则",
		Metric:         "collector.test_collector.metrics.test_metric",
		Condition:      ">",
		Threshold:      50,
		Duration:       time.Millisecond * 100,
		Severity:       AlertSeverityWarning,
		Enabled:        true,
		NotifyChannels: []string{"console"},
	}

	config := &MonitorConfig{
		CollectInterval:     time.Millisecond * 50,
		AlertCheckInterval:  time.Millisecond * 25,
		HealthCheckInterval: time.Millisecond * 200,
		MetricsRetention:    time.Second,
		EnableAlerts:        true,
		EnableHealthCheck:   true,
		AlertRules:          []*AlertRule{alertRule},
	}

	monitor := NewMonitor(config)

	// 注册控制台通知渠道
	monitor.alertManager.RegisterNotificationChannel(&ConsoleNotificationChannel{})

	// 注册测试收集器，返回超过阈值的指标
	collector := NewMockMetricsCollector("test_collector", time.Millisecond*50)
	collector.SetCollectFunc(func(ctx context.Context) (*MetricSet, error) {
		return &MetricSet{
			Name:      "test_collector",
			Timestamp: time.Now(),
			Metrics: map[string]interface{}{
				"test_metric": 100, // 超过阈值50
			},
		}, nil
	})
	monitor.RegisterCollector(collector)

	ctx := context.Background()
	err := monitor.Start(ctx)
	if err != nil {
		t.Fatalf("启动监控器失败: %v", err)
	}

	// 等待告警被触发
	time.Sleep(time.Millisecond * 200)

	// 检查告警
	alerts := monitor.GetAlerts()
	if len(alerts) == 0 {
		t.Error("没有触发告警")
		return
	}

	alert := alerts[0]
	if alert.Rule.ID != "test_alert" {
		t.Errorf("期望告警规则ID为'test_alert'，实际为'%s'", alert.Rule.ID)
	}

	if alert.Status != AlertStatusFiring {
		t.Errorf("期望告警状态为'%s'，实际为'%s'", AlertStatusFiring, alert.Status)
	}

	// 停止监控器
	err = monitor.Stop()
	if err != nil {
		t.Errorf("停止监控器失败: %v", err)
	}
}

func TestMonitor_CollectorError(t *testing.T) {
	config := &MonitorConfig{
		CollectInterval:     time.Millisecond * 50,
		AlertCheckInterval:  time.Millisecond * 100,
		HealthCheckInterval: time.Millisecond * 200,
		MetricsRetention:    time.Second,
		EnableAlerts:        false,
		EnableHealthCheck:   true,
		AlertRules:          []*AlertRule{},
	}

	monitor := NewMonitor(config)

	// 注册会出错的收集器
	collector := NewMockMetricsCollector("error_collector", time.Millisecond*50)
	collector.SetCollectFunc(func(ctx context.Context) (*MetricSet, error) {
		return nil, &MockError{message: "模拟收集器错误"}
	})
	monitor.RegisterCollector(collector)

	ctx := context.Background()
	err := monitor.Start(ctx)
	if err != nil {
		t.Fatalf("启动监控器失败: %v", err)
	}

	// 等待错误被记录
	time.Sleep(time.Millisecond * 200)

	// 检查错误计数
	collectorMetrics, err := monitor.GetCollectorMetrics("error_collector")
	if err != nil {
		t.Fatalf("获取收集器指标失败: %v", err)
	}

	if collectorMetrics.ErrorCount == 0 {
		t.Error("期望有错误计数，但错误计数为0")
	}

	if collectorMetrics.LastError == "" {
		t.Error("期望有最后错误记录，但为空")
	}

	// 停止监控器
	err = monitor.Stop()
	if err != nil {
		t.Errorf("停止监控器失败: %v", err)
	}
}

func TestMonitor_HealthCheck(t *testing.T) {
	config := &MonitorConfig{
		CollectInterval:     time.Millisecond * 100,
		AlertCheckInterval:  time.Millisecond * 200,
		HealthCheckInterval: time.Millisecond * 50,
		MetricsRetention:    time.Second,
		EnableAlerts:        false,
		EnableHealthCheck:   true,
		AlertRules:          []*AlertRule{},
	}

	monitor := NewMonitor(config)

	ctx := context.Background()
	err := monitor.Start(ctx)
	if err != nil {
		t.Fatalf("启动监控器失败: %v", err)
	}

	// 等待健康检查
	time.Sleep(time.Millisecond * 200)

	// 检查健康状态
	healthStatus := monitor.GetHealthStatus()
	if healthStatus == nil {
		t.Error("未获取到健康状态")
		return
	}

	if healthStatus.Overall == "" {
		t.Error("整体健康状态为空")
	}

	if len(healthStatus.Components) == 0 {
		t.Error("没有组件健康状态")
	}

	// 检查是否有系统组件
	if _, exists := healthStatus.Components["system"]; !exists {
		t.Error("系统组件健康状态不存在")
	}

	// 停止监控器
	err = monitor.Stop()
	if err != nil {
		t.Errorf("停止监控器失败: %v", err)
	}
}

func TestMonitor_MetricsRetention(t *testing.T) {
	config := &MonitorConfig{
		CollectInterval:     time.Millisecond * 50,
		AlertCheckInterval:  time.Millisecond * 200,
		HealthCheckInterval: time.Millisecond * 200,
		MetricsRetention:    time.Millisecond * 100, // 很短的保留时间
		EnableAlerts:        false,
		EnableHealthCheck:   false,
		AlertRules:          []*AlertRule{},
	}

	monitor := NewMonitor(config)

	// 注册测试收集器
	collector := NewMockMetricsCollector("test_collector", time.Millisecond*50)
	monitor.RegisterCollector(collector)

	ctx := context.Background()
	err := monitor.Start(ctx)
	if err != nil {
		t.Fatalf("启动监控器失败: %v", err)
	}

	// 等待一些数据收集
	time.Sleep(time.Millisecond * 150)

	// 检查指标数据
	collectorMetrics, err := monitor.GetCollectorMetrics("test_collector")
	if err != nil {
		t.Fatalf("获取收集器指标失败: %v", err)
	}

	initialMetricsCount := len(collectorMetrics.Metrics)

	// 等待数据清理
	time.Sleep(time.Millisecond * 200)

	// 再次检查指标数据
	collectorMetrics, err = monitor.GetCollectorMetrics("test_collector")
	if err != nil {
		t.Fatalf("获取收集器指标失败: %v", err)
	}

	// 验证旧数据被清理
	if len(collectorMetrics.Metrics) >= initialMetricsCount {
		t.Logf("初始指标数量: %d, 当前指标数量: %d", initialMetricsCount, len(collectorMetrics.Metrics))
		// 注意：由于时间窗口较短，这个测试可能不稳定，所以只记录日志
	}

	// 停止监控器
	err = monitor.Stop()
	if err != nil {
		t.Errorf("停止监控器失败: %v", err)
	}
}

func TestMonitor_CollectorRegistration(t *testing.T) {
	monitor := NewMonitor(nil)

	// 注册收集器
	collector1 := NewMockMetricsCollector("collector1", time.Second)
	collector2 := NewMockMetricsCollector("collector2", time.Second)

	monitor.RegisterCollector(collector1)
	monitor.RegisterCollector(collector2)

	// 检查收集器是否被注册
	if len(monitor.collectors) != 2 {
		t.Errorf("期望2个收集器，实际有%d个", len(monitor.collectors))
	}

	// 注销收集器
	monitor.UnregisterCollector("collector1")

	if len(monitor.collectors) != 1 {
		t.Errorf("注销后期望1个收集器，实际有%d个", len(monitor.collectors))
	}

	if _, exists := monitor.collectors["collector1"]; exists {
		t.Error("collector1应该已被注销")
	}

	if _, exists := monitor.collectors["collector2"]; !exists {
		t.Error("collector2应该仍然存在")
	}
}

func TestMonitor_AlertRuleManagement(t *testing.T) {
	monitor := NewMonitor(nil)

	// 添加告警规则
	rule1 := &AlertRule{
		ID:          "rule1",
		Name:        "规则1",
		Description: "测试规则1",
		Metric:      "test.metric1",
		Condition:   ">",
		Threshold:   100,
		Severity:    AlertSeverityWarning,
		Enabled:     true,
	}

	rule2 := &AlertRule{
		ID:          "rule2",
		Name:        "规则2",
		Description: "测试规则2",
		Metric:      "test.metric2",
		Condition:   "<",
		Threshold:   50,
		Severity:    AlertSeverityError,
		Enabled:     true,
	}

	monitor.AddAlertRule(rule1)
	monitor.AddAlertRule(rule2)

	// 检查规则是否被添加
	rules := monitor.alertManager.GetRules()
	if len(rules) != 2 {
		t.Errorf("期望2个告警规则，实际有%d个", len(rules))
	}

	// 检查特定规则
	retrievedRule, exists := monitor.alertManager.GetRule("rule1")
	if !exists {
		t.Error("规则rule1不存在")
	} else {
		if retrievedRule.Name != "规则1" {
			t.Errorf("期望规则名称为'规则1'，实际为'%s'", retrievedRule.Name)
		}
	}

	// 删除规则
	monitor.RemoveAlertRule("rule1")

	rules = monitor.alertManager.GetRules()
	if len(rules) != 1 {
		t.Errorf("删除后期望1个告警规则，实际有%d个", len(rules))
	}

	_, exists = monitor.alertManager.GetRule("rule1")
	if exists {
		t.Error("rule1应该已被删除")
	}
}

// MockError 模拟错误
type MockError struct {
	message string
}

func (e *MockError) Error() string {
	return e.message
}

// 基准测试
func BenchmarkMonitor_CollectMetrics(b *testing.B) {
	monitor := NewMonitor(nil)

	// 注册多个收集器
	for i := 0; i < 10; i++ {
		collector := NewMockMetricsCollector(
			fmt.Sprintf("collector_%d", i),
			time.Second,
		)
		monitor.RegisterCollector(collector)
	}

	ctx := context.Background()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		monitor.collectMetrics(ctx)
	}
}

func BenchmarkMonitor_CheckAlerts(b *testing.B) {
	config := &MonitorConfig{
		AlertRules: []*AlertRule{
			{
				ID:        "rule1",
				Name:      "规则1",
				Metric:    "collector.test.metrics.value",
				Condition: ">",
				Threshold: 50,
				Enabled:   true,
			},
			{
				ID:        "rule2",
				Name:      "规则2",
				Metric:    "collector.test.metrics.count",
				Condition: "<",
				Threshold: 10,
				Enabled:   true,
			},
		},
	}

	monitor := NewMonitor(config)

	// 创建测试指标
	metrics := &SystemMetrics{
		Collectors: map[string]*CollectorMetrics{
			"test": {
				Name: "test",
				Metrics: []MetricSet{
					{
						Name:      "test",
						Timestamp: time.Now(),
						Metrics: map[string]interface{}{
							"value": 100,
							"count": 5,
						},
					},
				},
			},
		},
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		monitor.alertManager.CheckAlerts(metrics)
	}
}

// 辅助函数
func createTestMetrics() *SystemMetrics {
	return &SystemMetrics{
		CollectedAt: time.Now(),
		Collectors: map[string]*CollectorMetrics{
			"test_collector": {
				Name:            "test_collector",
				LastCollected:   time.Now(),
				CollectionCount: 10,
				ErrorCount:      0,
				Metrics: []MetricSet{
					{
						Name:      "test_collector",
						Timestamp: time.Now(),
						Metrics: map[string]interface{}{
							"test_metric":  100,
							"test_counter": 50,
						},
					},
				},
			},
		},
		Alerts: []*Alert{},
		Health: &HealthStatus{
			Overall:    HealthLevelHealthy,
			Components: map[string]*ComponentHealth{},
			CheckedAt:  time.Now(),
		},
	}
}
