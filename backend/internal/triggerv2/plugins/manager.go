package plugins

import (
	"context"
	"fmt"
	"sync"
	"time"

	"mailman/internal/triggerv2/models"
)

// PluginManagerConfig 插件管理器配置
type PluginManagerConfig struct {
	// 基本配置
	MaxPlugins       int           `json:"max_plugins"`
	DefaultTimeout   time.Duration `json:"default_timeout"`
	MaxExecutionTime time.Duration `json:"max_execution_time"`
	CleanupInterval  time.Duration `json:"cleanup_interval"`
	StatsInterval    time.Duration `json:"stats_interval"`

	// 资源限制
	DefaultMaxMemory   int64         `json:"default_max_memory"`
	DefaultMaxCPU      int64         `json:"default_max_cpu"`
	DefaultMaxDuration time.Duration `json:"default_max_duration"`

	// 安全配置
	EnableSandbox      bool     `json:"enable_sandbox"`
	AllowedPermissions []string `json:"allowed_permissions"`
	RestrictedPlugins  []string `json:"restricted_plugins"`

	// 监控配置
	EnableMetrics bool `json:"enable_metrics"`
	EnableTracing bool `json:"enable_tracing"`
	EnableLogging bool `json:"enable_logging"`

	// 插件路径
	PluginPaths    []string `json:"plugin_paths"`
	AutoDiscovery  bool     `json:"auto_discovery"`
	ReloadOnChange bool     `json:"reload_on_change"`
}

// DefaultPluginManagerConfig 默认配置
func DefaultPluginManagerConfig() *PluginManagerConfig {
	return &PluginManagerConfig{
		MaxPlugins:         100,
		DefaultTimeout:     30 * time.Second,
		MaxExecutionTime:   60 * time.Second,
		CleanupInterval:    5 * time.Minute,
		StatsInterval:      1 * time.Minute,
		DefaultMaxMemory:   100 * 1024 * 1024, // 100MB
		DefaultMaxCPU:      80,                // 80%
		DefaultMaxDuration: 30 * time.Second,
		EnableSandbox:      true,
		AllowedPermissions: []string{PermissionRead, PermissionWrite},
		RestrictedPlugins:  []string{},
		EnableMetrics:      true,
		EnableTracing:      false,
		EnableLogging:      true,
		PluginPaths:        []string{"./plugins"},
		AutoDiscovery:      true,
		ReloadOnChange:     false,
	}
}

// TriggerV2PluginManager 插件管理器实现
type TriggerV2PluginManager struct {
	config   *PluginManagerConfig
	plugins  map[string]Plugin
	configs  map[string]*PluginConfig
	stats    map[string]*PluginStats
	registry PluginRegistry
	executor PluginExecutor
	security PluginSecurityManager

	// 状态管理
	mutex   sync.RWMutex
	running bool
	ctx     context.Context
	cancel  context.CancelFunc

	// 系统接口
	logger    Logger
	metrics   Metrics
	storage   Storage
	eventBus  EventBus
	scheduler Scheduler
	database  Database

	// 监控和统计
	lastCleanup time.Time
	lastStats   time.Time
}

// NewTriggerV2PluginManager 创建插件管理器
func NewTriggerV2PluginManager(config *PluginManagerConfig) PluginManager {
	if config == nil {
		config = DefaultPluginManagerConfig()
	}

	ctx, cancel := context.WithCancel(context.Background())

	manager := &TriggerV2PluginManager{
		config:   config,
		plugins:  make(map[string]Plugin),
		configs:  make(map[string]*PluginConfig),
		stats:    make(map[string]*PluginStats),
		ctx:      ctx,
		cancel:   cancel,
		registry: newPluginRegistry(),
		executor: newPluginExecutor(),
		security: newPluginSecurityManager(),
		// 提供默认的空实现
		logger:    &noopLogger{},
		metrics:   &noopMetrics{},
		storage:   &noopStorage{},
		eventBus:  &noopEventBus{},
		scheduler: &noopScheduler{},
		database:  &noopDatabase{},
	}

	// 启动后台任务
	go manager.backgroundTasks()

	return manager
}

// RegisterPlugin 注册插件
func (pm *TriggerV2PluginManager) RegisterPlugin(plugin Plugin) error {
	if plugin == nil {
		return fmt.Errorf("插件不能为空")
	}

	pm.mutex.Lock()
	defer pm.mutex.Unlock()

	info := plugin.GetInfo()
	if info == nil {
		return fmt.Errorf("插件信息不能为空")
	}

	if info.ID == "" {
		return fmt.Errorf("插件ID不能为空")
	}

	// 检查是否已存在
	if _, exists := pm.plugins[info.ID]; exists {
		return fmt.Errorf("插件 %s 已经注册", info.ID)
	}

	// 检查插件数量限制
	if len(pm.plugins) >= pm.config.MaxPlugins {
		return fmt.Errorf("已达到最大插件数量限制: %d", pm.config.MaxPlugins)
	}

	// 验证插件
	if err := pm.registry.ValidatePlugin(plugin); err != nil {
		return fmt.Errorf("插件验证失败: %w", err)
	}

	// 检查权限
	if err := pm.security.ValidatePermissions(info.ID, info.Permissions); err != nil {
		return fmt.Errorf("权限验证失败: %w", err)
	}

	// 初始化插件
	pluginCtx := &PluginContext{
		Context:   pm.ctx,
		PluginID:  info.ID,
		Config:    pm.getDefaultPluginConfig(),
		Logger:    pm.logger,
		Metrics:   pm.metrics,
		Storage:   pm.storage,
		EventBus:  pm.eventBus,
		Scheduler: pm.scheduler,
		Database:  pm.database,
	}

	if err := plugin.Initialize(pluginCtx); err != nil {
		return fmt.Errorf("插件初始化失败: %w", err)
	}

	// 加载插件
	if err := plugin.OnLoad(); err != nil {
		return fmt.Errorf("插件加载失败: %w", err)
	}

	// 注册插件
	pm.plugins[info.ID] = plugin
	pm.configs[info.ID] = pm.getDefaultPluginConfig()
	pm.stats[info.ID] = &PluginStats{
		PluginID:     info.ID,
		Status:       PluginStatusLoaded,
		LastUpdated:  time.Now(),
		ErrorsByType: make(map[string]int64),
	}

	// 发布事件
	if pm.eventBus != nil {
		eventData := map[string]interface{}{
			"plugin_id":      info.ID,
			"plugin_name":    info.Name,
			"plugin_version": info.Version,
		}
		event, err := models.NewEvent(models.EventType(EventPluginLoaded), "plugin_manager", "Plugin Loaded", eventData)
		if err == nil {
			pm.eventBus.Publish(event)
		}
	}

	pm.logInfo("插件 %s 注册成功", info.ID)
	return nil
}

// UnregisterPlugin 注销插件
func (pm *TriggerV2PluginManager) UnregisterPlugin(pluginID string) error {
	pm.mutex.Lock()
	defer pm.mutex.Unlock()

	plugin, exists := pm.plugins[pluginID]
	if !exists {
		return fmt.Errorf("插件 %s 不存在", pluginID)
	}

	// 停用插件
	if err := plugin.OnDeactivate(); err != nil {
		pm.logError("插件 %s 停用失败: %v", pluginID, err)
	}

	// 卸载插件
	if err := plugin.OnUnload(); err != nil {
		pm.logError("插件 %s 卸载失败: %v", pluginID, err)
	}

	// 清理插件
	if err := plugin.Cleanup(); err != nil {
		pm.logError("插件 %s 清理失败: %v", pluginID, err)
	}

	// 删除插件
	delete(pm.plugins, pluginID)
	delete(pm.configs, pluginID)

	// 更新统计信息
	if stats, exists := pm.stats[pluginID]; exists {
		stats.Status = PluginStatusUnloaded
		stats.LastUpdated = time.Now()
	}

	// 发布事件
	if pm.eventBus != nil {
		eventData := map[string]interface{}{
			"plugin_id": pluginID,
		}
		event, err := models.NewEvent(models.EventType(EventPluginUnloaded), "plugin_manager", "Plugin Unloaded", eventData)
		if err == nil {
			pm.eventBus.Publish(event)
		}
	}

	pm.logInfo("插件 %s 注销成功", pluginID)
	return nil
}

// GetPlugin 获取插件
func (pm *TriggerV2PluginManager) GetPlugin(pluginID string) (Plugin, error) {
	pm.mutex.RLock()
	defer pm.mutex.RUnlock()

	plugin, exists := pm.plugins[pluginID]
	if !exists {
		return nil, fmt.Errorf("插件 %s 不存在", pluginID)
	}

	return plugin, nil
}

// GetPluginsByType 按类型获取插件
func (pm *TriggerV2PluginManager) GetPluginsByType(pluginType PluginType) ([]Plugin, error) {
	pm.mutex.RLock()
	defer pm.mutex.RUnlock()

	var plugins []Plugin

	for _, plugin := range pm.plugins {
		info := plugin.GetInfo()
		if info != nil && info.Type == pluginType {
			plugins = append(plugins, plugin)
		}
	}

	return plugins, nil
}

// ListPlugins 列出所有插件
func (pm *TriggerV2PluginManager) ListPlugins() ([]*PluginInfo, error) {
	pm.mutex.RLock()
	defer pm.mutex.RUnlock()

	var infos []*PluginInfo

	for _, plugin := range pm.plugins {
		info := plugin.GetInfo()
		if info != nil {
			infos = append(infos, info)
		}
	}

	return infos, nil
}

// LoadPlugin 加载插件
func (pm *TriggerV2PluginManager) LoadPlugin(pluginID string) error {
	pm.mutex.Lock()
	defer pm.mutex.Unlock()

	plugin, exists := pm.plugins[pluginID]
	if !exists {
		return fmt.Errorf("插件 %s 不存在", pluginID)
	}

	if err := plugin.OnLoad(); err != nil {
		return fmt.Errorf("插件加载失败: %w", err)
	}

	// 更新状态
	if stats, exists := pm.stats[pluginID]; exists {
		stats.Status = PluginStatusLoaded
		stats.LastUpdated = time.Now()
	}

	pm.logInfo("插件 %s 加载成功", pluginID)
	return nil
}

// UnloadPlugin 卸载插件
func (pm *TriggerV2PluginManager) UnloadPlugin(pluginID string) error {
	pm.mutex.Lock()
	defer pm.mutex.Unlock()

	plugin, exists := pm.plugins[pluginID]
	if !exists {
		return fmt.Errorf("插件 %s 不存在", pluginID)
	}

	if err := plugin.OnUnload(); err != nil {
		return fmt.Errorf("插件卸载失败: %w", err)
	}

	// 更新状态
	if stats, exists := pm.stats[pluginID]; exists {
		stats.Status = PluginStatusUnloaded
		stats.LastUpdated = time.Now()
	}

	pm.logInfo("插件 %s 卸载成功", pluginID)
	return nil
}

// ActivatePlugin 激活插件
func (pm *TriggerV2PluginManager) ActivatePlugin(pluginID string) error {
	pm.mutex.Lock()
	defer pm.mutex.Unlock()

	plugin, exists := pm.plugins[pluginID]
	if !exists {
		return fmt.Errorf("插件 %s 不存在", pluginID)
	}

	if err := plugin.OnActivate(); err != nil {
		return fmt.Errorf("插件激活失败: %w", err)
	}

	// 更新状态
	if stats, exists := pm.stats[pluginID]; exists {
		stats.Status = PluginStatusActive
		stats.LastUpdated = time.Now()
	}

	// 发布事件
	if pm.eventBus != nil {
		eventData := map[string]interface{}{
			"plugin_id": pluginID,
		}
		event, err := models.NewEvent(models.EventType(EventPluginActivated), "plugin_manager", "Plugin Activated", eventData)
		if err == nil {
			pm.eventBus.Publish(event)
		}
	}

	pm.logInfo("插件 %s 激活成功", pluginID)
	return nil
}

// DeactivatePlugin 停用插件
func (pm *TriggerV2PluginManager) DeactivatePlugin(pluginID string) error {
	pm.mutex.Lock()
	defer pm.mutex.Unlock()

	plugin, exists := pm.plugins[pluginID]
	if !exists {
		return fmt.Errorf("插件 %s 不存在", pluginID)
	}

	if err := plugin.OnDeactivate(); err != nil {
		return fmt.Errorf("插件停用失败: %w", err)
	}

	// 更新状态
	if stats, exists := pm.stats[pluginID]; exists {
		stats.Status = PluginStatusInactive
		stats.LastUpdated = time.Now()
	}

	// 发布事件
	if pm.eventBus != nil {
		eventData := map[string]interface{}{
			"plugin_id": pluginID,
		}
		event, err := models.NewEvent(models.EventType(EventPluginDeactivated), "plugin_manager", "Plugin Deactivated", eventData)
		if err == nil {
			pm.eventBus.Publish(event)
		}
	}

	pm.logInfo("插件 %s 停用成功", pluginID)
	return nil
}

// GetPluginConfig 获取插件配置
func (pm *TriggerV2PluginManager) GetPluginConfig(pluginID string) (*PluginConfig, error) {
	pm.mutex.RLock()
	defer pm.mutex.RUnlock()

	config, exists := pm.configs[pluginID]
	if !exists {
		return nil, fmt.Errorf("插件 %s 的配置不存在", pluginID)
	}

	return config, nil
}

// SetPluginConfig 设置插件配置
func (pm *TriggerV2PluginManager) SetPluginConfig(pluginID string, config *PluginConfig) error {
	pm.mutex.Lock()
	defer pm.mutex.Unlock()

	plugin, exists := pm.plugins[pluginID]
	if !exists {
		return fmt.Errorf("插件 %s 不存在", pluginID)
	}

	// 验证配置
	if err := plugin.ValidateConfig(config.Config); err != nil {
		return fmt.Errorf("配置验证失败: %w", err)
	}

	// 应用配置
	if err := plugin.ApplyConfig(config.Config); err != nil {
		return fmt.Errorf("配置应用失败: %w", err)
	}

	// 保存配置
	pm.configs[pluginID] = config

	// 发布事件
	if pm.eventBus != nil {
		eventData := map[string]interface{}{
			"plugin_id": pluginID,
			"config":    config,
		}
		event, err := models.NewEvent(models.EventType(EventPluginConfigUpdated), "plugin_manager", "Plugin Config Updated", eventData)
		if err == nil {
			pm.eventBus.Publish(event)
		}
	}

	pm.logInfo("插件 %s 配置更新成功", pluginID)
	return nil
}

// ExecuteCondition 执行条件插件
func (pm *TriggerV2PluginManager) ExecuteCondition(pluginID string, ctx *PluginContext, event *models.Event) (*PluginResult, error) {
	plugin, err := pm.GetPlugin(pluginID)
	if err != nil {
		return nil, err
	}

	conditionPlugin, ok := plugin.(ConditionPlugin)
	if !ok {
		return nil, fmt.Errorf("插件 %s 不是条件插件", pluginID)
	}

	// 检查插件状态
	if err := pm.checkPluginStatus(pluginID); err != nil {
		return nil, err
	}

	if ctx != nil && ctx.Config != nil && ctx.Config.Config != nil {
		if err := conditionPlugin.ApplyConfig(ctx.Config.Config); err != nil {
			return nil, fmt.Errorf("条件插件配置应用失败: %w", err)
		}
	}

	// 执行条件
	startTime := time.Now()
	result, err := pm.executor.Execute(ctx, conditionPlugin, event)
	executionTime := time.Since(startTime)

	// 更新统计信息
	pm.updatePluginStats(pluginID, executionTime, err)

	// 发布执行事件
	pm.publishExecutionEvent(pluginID, "condition", executionTime, err)

	return result, err
}

// ExecuteAction 执行动作插件
func (pm *TriggerV2PluginManager) ExecuteAction(pluginID string, ctx *PluginContext, event *models.Event) (*PluginResult, error) {
	plugin, err := pm.GetPlugin(pluginID)
	if err != nil {
		return nil, err
	}

	actionPlugin, ok := plugin.(ActionPlugin)
	if !ok {
		return nil, fmt.Errorf("插件 %s 不是动作插件", pluginID)
	}

	// 检查插件状态
	if err := pm.checkPluginStatus(pluginID); err != nil {
		return nil, err
	}

	// 应用配置
	if ctx.Config != nil && ctx.Config.Config != nil {
		if err := actionPlugin.ApplyConfig(ctx.Config.Config); err != nil {
			return nil, fmt.Errorf("应用插件配置失败: %v", err)
		}
	}

	// 检查是否可以执行
	if !actionPlugin.CanExecute(ctx, event) {
		return nil, fmt.Errorf("插件 %s 不能执行此动作", pluginID)
	}

	// 执行动作
	startTime := time.Now()
	result, err := pm.executor.Execute(ctx, actionPlugin, event)
	executionTime := time.Since(startTime)

	// 更新统计信息
	pm.updatePluginStats(pluginID, executionTime, err)

	// 发布执行事件
	pm.publishExecutionEvent(pluginID, "action", executionTime, err)

	return result, err
}

// ExecuteTransform 执行转换插件
func (pm *TriggerV2PluginManager) ExecuteTransform(pluginID string, ctx *PluginContext, event *models.Event) (*models.Event, error) {
	plugin, err := pm.GetPlugin(pluginID)
	if err != nil {
		return nil, err
	}

	transformPlugin, ok := plugin.(TransformPlugin)
	if !ok {
		return nil, fmt.Errorf("插件 %s 不是转换插件", pluginID)
	}

	// 检查插件状态
	if err := pm.checkPluginStatus(pluginID); err != nil {
		return nil, err
	}

	// 执行转换
	startTime := time.Now()
	transformedEvent, err := transformPlugin.Transform(ctx, event)
	executionTime := time.Since(startTime)

	// 更新统计信息
	pm.updatePluginStats(pluginID, executionTime, err)

	// 发布执行事件
	pm.publishExecutionEvent(pluginID, "transform", executionTime, err)

	return transformedEvent, err
}

// ExecuteFilter 执行过滤插件
func (pm *TriggerV2PluginManager) ExecuteFilter(pluginID string, ctx *PluginContext, event *models.Event) (bool, error) {
	plugin, err := pm.GetPlugin(pluginID)
	if err != nil {
		return false, err
	}

	filterPlugin, ok := plugin.(FilterPlugin)
	if !ok {
		return false, fmt.Errorf("插件 %s 不是过滤插件", pluginID)
	}

	// 检查插件状态
	if err := pm.checkPluginStatus(pluginID); err != nil {
		return false, err
	}

	// 执行过滤
	startTime := time.Now()
	result, err := filterPlugin.Filter(ctx, event)
	executionTime := time.Since(startTime)

	// 更新统计信息
	pm.updatePluginStats(pluginID, executionTime, err)

	// 发布执行事件
	pm.publishExecutionEvent(pluginID, "filter", executionTime, err)

	return result, err
}

// GetPluginStats 获取插件统计信息
func (pm *TriggerV2PluginManager) GetPluginStats(pluginID string) (*PluginStats, error) {
	pm.mutex.RLock()
	defer pm.mutex.RUnlock()

	stats, exists := pm.stats[pluginID]
	if !exists {
		return nil, fmt.Errorf("插件 %s 的统计信息不存在", pluginID)
	}

	return stats, nil
}

// GetAllPluginStats 获取所有插件统计信息
func (pm *TriggerV2PluginManager) GetAllPluginStats() (map[string]*PluginStats, error) {
	pm.mutex.RLock()
	defer pm.mutex.RUnlock()

	result := make(map[string]*PluginStats)
	for pluginID, stats := range pm.stats {
		result[pluginID] = stats
	}

	return result, nil
}

// CheckPluginHealth 检查插件健康状态
func (pm *TriggerV2PluginManager) CheckPluginHealth(pluginID string) error {
	plugin, err := pm.GetPlugin(pluginID)
	if err != nil {
		return err
	}

	return plugin.HealthCheck()
}

// CheckAllPluginsHealth 检查所有插件健康状态
func (pm *TriggerV2PluginManager) CheckAllPluginsHealth() (map[string]error, error) {
	pm.mutex.RLock()
	defer pm.mutex.RUnlock()

	result := make(map[string]error)

	for pluginID, plugin := range pm.plugins {
		err := plugin.HealthCheck()
		if err != nil {
			result[pluginID] = err
		}
	}

	return result, nil
}

// 私有方法

// getDefaultPluginConfig 获取默认插件配置
func (pm *TriggerV2PluginManager) getDefaultPluginConfig() *PluginConfig {
	return &PluginConfig{
		Enabled:       true,
		Config:        make(map[string]interface{}),
		Timeout:       pm.config.DefaultTimeout,
		MaxRetries:    3,
		RetryDelay:    1 * time.Second,
		MaxMemory:     pm.config.DefaultMaxMemory,
		MaxCPU:        pm.config.DefaultMaxCPU,
		MaxDuration:   pm.config.DefaultMaxDuration,
		EnableMetrics: pm.config.EnableMetrics,
		EnableTracing: pm.config.EnableTracing,
		EnableLogging: pm.config.EnableLogging,
	}
}

// checkPluginStatus 检查插件状态
func (pm *TriggerV2PluginManager) checkPluginStatus(pluginID string) error {
	pm.mutex.RLock()
	defer pm.mutex.RUnlock()

	config, exists := pm.configs[pluginID]
	if !exists {
		return fmt.Errorf("插件 %s 的配置不存在", pluginID)
	}

	if !config.Enabled {
		return fmt.Errorf("插件 %s 未启用", pluginID)
	}

	stats, exists := pm.stats[pluginID]
	if !exists {
		return fmt.Errorf("插件 %s 的统计信息不存在", pluginID)
	}

	if stats.Status == PluginStatusError {
		return fmt.Errorf("插件 %s 处于错误状态", pluginID)
	}

	return nil
}

// updatePluginStats 更新插件统计信息
func (pm *TriggerV2PluginManager) updatePluginStats(pluginID string, executionTime time.Duration, err error) {
	pm.mutex.Lock()
	defer pm.mutex.Unlock()

	stats, exists := pm.stats[pluginID]
	if !exists {
		return
	}

	stats.TotalExecutions++
	stats.LastUpdated = time.Now()

	if err != nil {
		stats.FailedExecutions++
		stats.LastError = err.Error()
		stats.LastErrorAt = time.Now()

		// 更新错误统计
		errorType := "unknown"
		if stats.ErrorsByType == nil {
			stats.ErrorsByType = make(map[string]int64)
		}
		stats.ErrorsByType[errorType]++
	} else {
		stats.SuccessExecutions++
	}

	// 更新执行时间统计
	if stats.TotalExecutions == 1 {
		stats.AvgExecutionTime = executionTime
		stats.MaxExecutionTime = executionTime
		stats.MinExecutionTime = executionTime
	} else {
		// 计算平均执行时间
		totalTime := stats.AvgExecutionTime*time.Duration(stats.TotalExecutions-1) + executionTime
		stats.AvgExecutionTime = totalTime / time.Duration(stats.TotalExecutions)

		// 更新最大和最小执行时间
		if executionTime > stats.MaxExecutionTime {
			stats.MaxExecutionTime = executionTime
		}
		if executionTime < stats.MinExecutionTime {
			stats.MinExecutionTime = executionTime
		}
	}

	// 计算执行率和成功率
	stats.SuccessRate = float64(stats.SuccessExecutions) / float64(stats.TotalExecutions)
	stats.ErrorRate = float64(stats.FailedExecutions) / float64(stats.TotalExecutions)
}

// publishExecutionEvent 发布执行事件
func (pm *TriggerV2PluginManager) publishExecutionEvent(pluginID, pluginType string, executionTime time.Duration, err error) {
	if pm.eventBus == nil {
		return
	}

	eventType := EventPluginExecutionCompleted
	if err != nil {
		eventType = EventPluginExecutionFailed
	}

	eventData := map[string]interface{}{
		"plugin_id":      pluginID,
		"plugin_type":    pluginType,
		"execution_time": executionTime,
		"error":          err,
	}

	event, createErr := models.NewEvent(models.EventType(eventType), "plugin_manager", "Plugin Execution Event", eventData)
	if createErr == nil {
		pm.eventBus.Publish(event)
	}
}

// backgroundTasks 后台任务
func (pm *TriggerV2PluginManager) backgroundTasks() {
	cleanupTicker := time.NewTicker(pm.config.CleanupInterval)
	statsTicker := time.NewTicker(pm.config.StatsInterval)

	defer cleanupTicker.Stop()
	defer statsTicker.Stop()

	for {
		select {
		case <-pm.ctx.Done():
			return
		case <-cleanupTicker.C:
			pm.performCleanup()
		case <-statsTicker.C:
			pm.updateStats()
		}
	}
}

// performCleanup 执行清理
func (pm *TriggerV2PluginManager) performCleanup() {
	pm.mutex.Lock()
	defer pm.mutex.Unlock()

	pm.lastCleanup = time.Now()

	// 清理过期的统计信息
	for pluginID, stats := range pm.stats {
		if stats.Status == PluginStatusUnloaded &&
			time.Since(stats.LastUpdated) > 24*time.Hour {
			delete(pm.stats, pluginID)
		}
	}
}

// updateStats 更新统计信息
func (pm *TriggerV2PluginManager) updateStats() {
	pm.mutex.Lock()
	defer pm.mutex.Unlock()

	pm.lastStats = time.Now()

	// 更新插件统计信息
	for pluginID := range pm.stats {
		// 这里可以添加更复杂的统计计算逻辑
		_ = pluginID
	}
}

// 日志方法

func (pm *TriggerV2PluginManager) logInfo(format string, args ...interface{}) {
	if pm.logger != nil {
		pm.logger.Info(format, args...)
	}
}

func (pm *TriggerV2PluginManager) logError(format string, args ...interface{}) {
	if pm.logger != nil {
		pm.logger.Error(format, args...)
	}
}

func (pm *TriggerV2PluginManager) logDebug(format string, args ...interface{}) {
	if pm.logger != nil {
		pm.logger.Debug(format, args...)
	}
}

func (pm *TriggerV2PluginManager) logWarn(format string, args ...interface{}) {
	if pm.logger != nil {
		pm.logger.Warn(format, args...)
	}
}

// Shutdown 关闭插件管理器
func (pm *TriggerV2PluginManager) Shutdown() error {
	pm.mutex.Lock()
	defer pm.mutex.Unlock()

	pm.running = false
	pm.cancel()

	// 卸载所有插件
	for pluginID := range pm.plugins {
		if err := pm.UnregisterPlugin(pluginID); err != nil {
			pm.logError("卸载插件 %s 失败: %v", pluginID, err)
		}
	}

	pm.logInfo("插件管理器已关闭")
	return nil
}

// 构造函数实现

// newPluginRegistry 创建插件注册表
func newPluginRegistry() PluginRegistry {
	return &DefaultPluginRegistry{}
}

// newPluginExecutor 创建插件执行器
func newPluginExecutor() PluginExecutor {
	return &DefaultPluginExecutor{}
}

// newPluginSecurityManager 创建插件安全管理器
func newPluginSecurityManager() PluginSecurityManager {
	return &DefaultPluginSecurityManager{}
}

// 默认实现

// DefaultPluginRegistry 默认插件注册表
type DefaultPluginRegistry struct{}

func (r *DefaultPluginRegistry) DiscoverPlugins(paths []string) ([]Plugin, error) {
	return []Plugin{}, nil
}

func (r *DefaultPluginRegistry) LoadPluginFromFile(filePath string) (Plugin, error) {
	return nil, fmt.Errorf("not implemented")
}

func (r *DefaultPluginRegistry) LoadPluginFromBytes(data []byte) (Plugin, error) {
	return nil, fmt.Errorf("not implemented")
}

func (r *DefaultPluginRegistry) ValidatePlugin(plugin Plugin) error {
	if plugin == nil {
		return fmt.Errorf("插件不能为空")
	}
	info := plugin.GetInfo()
	if info == nil {
		return fmt.Errorf("插件信息不能为空")
	}
	if info.ID == "" {
		return fmt.Errorf("插件ID不能为空")
	}
	if info.Name == "" {
		return fmt.Errorf("插件名称不能为空")
	}
	if info.Version == "" {
		return fmt.Errorf("插件版本不能为空")
	}
	return nil
}

func (r *DefaultPluginRegistry) ValidatePluginFile(filePath string) error {
	return fmt.Errorf("not implemented")
}

func (r *DefaultPluginRegistry) GetPluginInfo(filePath string) (*PluginInfo, error) {
	return nil, fmt.Errorf("not implemented")
}

func (r *DefaultPluginRegistry) GetAvailablePlugins() ([]*PluginInfo, error) {
	return []*PluginInfo{}, nil
}

// DefaultPluginExecutor 默认插件执行器
type DefaultPluginExecutor struct{}

func (e *DefaultPluginExecutor) Execute(ctx *PluginContext, plugin Plugin, args ...interface{}) (*PluginResult, error) {
	startTime := time.Now()

	// 根据插件类型执行不同的方法
	switch p := plugin.(type) {
	case ConditionPlugin:
		if len(args) > 0 {
			if event, ok := args[0].(*models.Event); ok {
				result, err := p.Evaluate(ctx, event)
				return result, err
			}
		}
		return nil, fmt.Errorf("条件插件需要事件参数")
	case ActionPlugin:
		if len(args) > 0 {
			if event, ok := args[0].(*models.Event); ok {
				result, err := p.Execute(ctx, event)
				return result, err
			}
		}
		return nil, fmt.Errorf("动作插件需要事件参数")
	default:
		return &PluginResult{
			Success:       false,
			Error:         "不支持的插件类型",
			ExecutionTime: time.Since(startTime),
			Timestamp:     time.Now(),
		}, nil
	}
}

func (e *DefaultPluginExecutor) ExecuteWithTimeout(ctx *PluginContext, plugin Plugin, timeout time.Duration, args ...interface{}) (*PluginResult, error) {
	timeoutCtx, cancel := context.WithTimeout(ctx.Context, timeout)
	defer cancel()

	newCtx := &PluginContext{
		Context:   timeoutCtx,
		PluginID:  ctx.PluginID,
		Config:    ctx.Config,
		Event:     ctx.Event,
		TriggerID: ctx.TriggerID,
		Logger:    ctx.Logger,
		Metrics:   ctx.Metrics,
		Storage:   ctx.Storage,
		EventBus:  ctx.EventBus,
		Scheduler: ctx.Scheduler,
		Database:  ctx.Database,
	}

	return e.Execute(newCtx, plugin, args...)
}

func (e *DefaultPluginExecutor) GetExecutionStats(pluginID string) (*PluginStats, error) {
	return nil, fmt.Errorf("not implemented")
}

// DefaultPluginSecurityManager 默认插件安全管理器
type DefaultPluginSecurityManager struct{}

func (s *DefaultPluginSecurityManager) ValidatePermissions(pluginID string, permissions []string) error {
	// 简单的权限验证
	for _, permission := range permissions {
		if permission == "admin" || permission == "system" {
			return fmt.Errorf("插件 %s 请求了危险权限: %s", pluginID, permission)
		}
	}
	return nil
}

func (s *DefaultPluginSecurityManager) CheckPermission(pluginID string, permission string) bool {
	// 简单的权限检查
	return permission != "admin" && permission != "system"
}

func (s *DefaultPluginSecurityManager) CreateSandbox(pluginID string) (Sandbox, error) {
	return &DefaultSandbox{}, nil
}

func (s *DefaultPluginSecurityManager) DestroySandbox(pluginID string) error {
	return nil
}

// DefaultSandbox 默认沙箱
type DefaultSandbox struct{}

func (s *DefaultSandbox) Execute(fn func() error) error {
	return fn()
}

func (s *DefaultSandbox) SetResourceLimits(limits *ResourceLimits) error {
	return nil
}

func (s *DefaultSandbox) GetResourceUsage() (*ResourceUsage, error) {
	return &ResourceUsage{
		MemoryUsage: 0,
		CPUUsage:    0,
		Duration:    0,
		Timestamp:   time.Now(),
	}, nil
}

// 空实现用于系统接口
type noopLogger struct{}

func (l *noopLogger) Debug(msg string, args ...interface{}) {}
func (l *noopLogger) Info(msg string, args ...interface{})  {}
func (l *noopLogger) Warn(msg string, args ...interface{})  {}
func (l *noopLogger) Error(msg string, args ...interface{}) {}
func (l *noopLogger) Fatal(msg string, args ...interface{}) {}

type noopMetrics struct{}

func (m *noopMetrics) Counter(name string, value int64, tags map[string]string)          {}
func (m *noopMetrics) Gauge(name string, value float64, tags map[string]string)          {}
func (m *noopMetrics) Histogram(name string, value float64, tags map[string]string)      {}
func (m *noopMetrics) Timer(name string, duration time.Duration, tags map[string]string) {}

type noopStorage struct{}

func (s *noopStorage) Get(key string) ([]byte, error)       { return nil, nil }
func (s *noopStorage) Set(key string, value []byte) error   { return nil }
func (s *noopStorage) Delete(key string) error              { return nil }
func (s *noopStorage) List(prefix string) ([]string, error) { return nil, nil }
func (s *noopStorage) Exists(key string) bool               { return false }

type noopEventBus struct{}

func (e *noopEventBus) Publish(event *models.Event) error                               { return nil }
func (e *noopEventBus) Subscribe(eventType string, handler func(*models.Event)) error   { return nil }
func (e *noopEventBus) Unsubscribe(eventType string, handler func(*models.Event)) error { return nil }

type noopScheduler struct{}

func (s *noopScheduler) ScheduleTask(task Task) error   { return nil }
func (s *noopScheduler) CancelTask(taskID string) error { return nil }
func (s *noopScheduler) GetTaskStatus(taskID string) (TaskStatus, error) {
	return TaskStatusPending, nil
}

type noopDatabase struct{}

func (d *noopDatabase) Query(query string, args ...interface{}) ([]map[string]interface{}, error) {
	return nil, nil
}
func (d *noopDatabase) Execute(query string, args ...interface{}) error { return nil }
func (d *noopDatabase) Transaction(fn func(tx Database) error) error    { return nil }
