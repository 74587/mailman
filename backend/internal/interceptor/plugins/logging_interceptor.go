package plugins

import (
	"encoding/json"
	"fmt"
	"log"
	"time"

	"mailman/internal/interceptor"
	"mailman/internal/models"
	triggerPlugins "mailman/internal/triggerv2/plugins"
)

// LogSaveCallback 日志保存回调函数类型
type LogSaveCallback func(logEntry *models.InterceptorLog) error

// LoggingInterceptor 日志记录拦截器插件
type LoggingInterceptor struct {
	config       *LoggingConfig
	saveCallback LogSaveCallback // 日志保存回调
}

// LoggingConfig 日志拦截器配置
type LoggingConfig struct {
	LogLevel        string `json:"log_level"`         // 日志级别: debug, info, warn, error
	LogInput        bool   `json:"log_input"`         // 记录输入数据
	LogOutput       bool   `json:"log_output"`        // 记录输出数据
	LogActionConfig bool   `json:"log_action_config"` // 记录动作配置
	LogDuration     bool   `json:"log_duration"`      // 记录执行时长
	LogVariables    bool   `json:"log_variables"`     // 记录变量上下文
	MaxDataLength   int    `json:"max_data_length"`   // 数据最大长度(防止日志过大)
	RetentionDays   int    `json:"retention_days"`    // 日志保留天数
}

// DefaultLoggingConfig 默认日志配置
func DefaultLoggingConfig() *LoggingConfig {
	return &LoggingConfig{
		LogLevel:        "info",
		LogInput:        true,
		LogOutput:       true,
		LogActionConfig: false,
		LogDuration:     true,
		LogVariables:    false,
		MaxDataLength:   10000,
		RetentionDays:   30,
	}
}

// NewLoggingInterceptor 创建日志拦截器
func NewLoggingInterceptor() *LoggingInterceptor {
	return &LoggingInterceptor{
		config: DefaultLoggingConfig(),
	}
}

// SetLogSaver 设置日志保存回调
// 当设置后，日志会通过此回调持久化到数据库
func (l *LoggingInterceptor) SetLogSaver(callback LogSaveCallback) {
	l.saveCallback = callback
}

// GetInfo 获取插件信息
func (l *LoggingInterceptor) GetInfo() *triggerPlugins.PluginInfo {
	return &triggerPlugins.PluginInfo{
		ID:          "logging_interceptor",
		Name:        "日志记录拦截器",
		Version:     "1.0.0",
		Description: "记录动作执行的详细日志，用于审计和问题排查",
		Author:      "Mailman",
		Type:        triggerPlugins.PluginTypeFilter, // 使用 Filter 类型表示拦截器
		Status:      triggerPlugins.PluginStatusActive,
		ConfigSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"log_level": map[string]interface{}{
					"type":        "string",
					"enum":        []string{"debug", "info", "warn", "error"},
					"default":     "info",
					"description": "日志级别",
				},
				"log_input": map[string]interface{}{
					"type":        "boolean",
					"default":     true,
					"description": "是否记录输入数据",
				},
				"log_output": map[string]interface{}{
					"type":        "boolean",
					"default":     true,
					"description": "是否记录输出数据",
				},
				"log_action_config": map[string]interface{}{
					"type":        "boolean",
					"default":     false,
					"description": "是否记录动作配置",
				},
				"log_duration": map[string]interface{}{
					"type":        "boolean",
					"default":     true,
					"description": "是否记录执行时长",
				},
				"log_variables": map[string]interface{}{
					"type":        "boolean",
					"default":     false,
					"description": "是否记录变量上下文",
				},
				"max_data_length": map[string]interface{}{
					"type":        "integer",
					"default":     10000,
					"minimum":     100,
					"maximum":     100000,
					"description": "数据最大长度(字符)",
				},
				"retention_days": map[string]interface{}{
					"type":        "integer",
					"default":     30,
					"minimum":     1,
					"maximum":     365,
					"description": "日志保留天数",
				},
			},
		},
		DefaultConfig: map[string]interface{}{
			"log_level":         "info",
			"log_input":         true,
			"log_output":        true,
			"log_action_config": false,
			"log_duration":      true,
			"log_variables":     false,
			"max_data_length":   10000,
			"retention_days":    30,
		},
	}
}

// Initialize 初始化插件
func (l *LoggingInterceptor) Initialize(ctx *triggerPlugins.PluginContext) error {
	log.Printf("[LoggingInterceptor] Initialized")
	return nil
}

// Cleanup 清理资源
func (l *LoggingInterceptor) Cleanup() error {
	return nil
}

// OnLoad 插件加载时调用
func (l *LoggingInterceptor) OnLoad() error {
	log.Printf("[LoggingInterceptor] Loaded")
	return nil
}

// OnUnload 插件卸载时调用
func (l *LoggingInterceptor) OnUnload() error {
	log.Printf("[LoggingInterceptor] Unloaded")
	return nil
}

// OnActivate 插件激活时调用
func (l *LoggingInterceptor) OnActivate() error {
	return nil
}

// OnDeactivate 插件停用时调用
func (l *LoggingInterceptor) OnDeactivate() error {
	return nil
}

// GetDefaultConfig 获取默认配置
func (l *LoggingInterceptor) GetDefaultConfig() map[string]interface{} {
	return l.GetInfo().DefaultConfig
}

// ValidateConfig 验证配置
func (l *LoggingInterceptor) ValidateConfig(config map[string]interface{}) error {
	// 验证日志级别
	if level, ok := config["log_level"].(string); ok {
		validLevels := map[string]bool{"debug": true, "info": true, "warn": true, "error": true}
		if !validLevels[level] {
			return fmt.Errorf("invalid log_level: %s", level)
		}
	}

	// 验证数据长度限制
	if maxLen, ok := config["max_data_length"].(float64); ok {
		if maxLen < 100 || maxLen > 100000 {
			return fmt.Errorf("max_data_length must be between 100 and 100000")
		}
	}

	return nil
}

// ApplyConfig 应用配置
func (l *LoggingInterceptor) ApplyConfig(config map[string]interface{}) error {
	if err := l.ValidateConfig(config); err != nil {
		return err
	}

	// 解析配置
	newConfig := DefaultLoggingConfig()

	if level, ok := config["log_level"].(string); ok {
		newConfig.LogLevel = level
	}
	if logInput, ok := config["log_input"].(bool); ok {
		newConfig.LogInput = logInput
	}
	if logOutput, ok := config["log_output"].(bool); ok {
		newConfig.LogOutput = logOutput
	}
	if logActionConfig, ok := config["log_action_config"].(bool); ok {
		newConfig.LogActionConfig = logActionConfig
	}
	if logDuration, ok := config["log_duration"].(bool); ok {
		newConfig.LogDuration = logDuration
	}
	if logVariables, ok := config["log_variables"].(bool); ok {
		newConfig.LogVariables = logVariables
	}
	if maxLen, ok := config["max_data_length"].(float64); ok {
		newConfig.MaxDataLength = int(maxLen)
	}
	if retention, ok := config["retention_days"].(float64); ok {
		newConfig.RetentionDays = int(retention)
	}

	l.config = newConfig
	return nil
}

// HealthCheck 健康检查
func (l *LoggingInterceptor) HealthCheck() error {
	return nil
}

// GetMetrics 获取指标
func (l *LoggingInterceptor) GetMetrics() map[string]interface{} {
	return map[string]interface{}{
		"status": "healthy",
	}
}

// GetType 获取拦截器类型
// 日志拦截器是环绕类型，必须前后配合工作
// - 前置阶段: 生成执行ID、记录开始时间
// - 后置阶段: 记录执行结果、计算执行时长
func (l *LoggingInterceptor) GetType() interceptor.Type {
	return interceptor.TypeAround
}

// GetSupportedPhases 获取支持的执行阶段
func (l *LoggingInterceptor) GetSupportedPhases() []interceptor.Phase {
	return []interceptor.Phase{interceptor.PhaseBefore, interceptor.PhaseAfter}
}

// BeforeAction 前置拦截
// 对于环绕型拦截器，before 阶段只记录开始时间，不写数据库
func (l *LoggingInterceptor) BeforeAction(ctx *interceptor.InterceptorContext) (*interceptor.InterceptorResult, error) {
	startTime := time.Now()

	// 构建日志消息并输出到控制台
	logEntry := l.buildLogEntry(ctx, "before")
	l.log(logEntry)

	// 保存开始时间到 Metadata，供 AfterAction 使用
	if ctx.Metadata == nil {
		ctx.Metadata = make(map[string]interface{})
	}
	ctx.Metadata["logging_interceptor_start_time"] = startTime

	// 环绕型拦截器不在 before 阶段写数据库，等到 after 阶段一起写
	return &interceptor.InterceptorResult{
		Decision:      interceptor.DecisionContinue,
		Success:       true,
		ExecutionTime: time.Since(startTime),
		Data: map[string]interface{}{
			"logged":    true,
			"phase":     "before",
			"timestamp": time.Now().Format(time.RFC3339),
		},
	}, nil
}

// AfterAction 后置拦截
// 对于环绕型拦截器，after 阶段记录完整的执行日志（包含 before 到 after 的完整信息）
func (l *LoggingInterceptor) AfterAction(ctx *interceptor.InterceptorContext) (*interceptor.InterceptorResult, error) {
	afterStartTime := time.Now()

	// 获取 before 阶段保存的开始时间
	var beforeStartTime time.Time
	if ctx.Metadata != nil {
		if st, ok := ctx.Metadata["logging_interceptor_start_time"].(time.Time); ok {
			beforeStartTime = st
		}
	}
	if beforeStartTime.IsZero() {
		beforeStartTime = ctx.StartTime // 回退到上下文的开始时间
	}

	// 构建日志消息
	logEntry := l.buildLogEntry(ctx, "after")

	// 添加动作执行结果
	actionSuccess := true
	actionError := ""
	actionResult := ""
	if ctx.ActionResult != nil {
		actionSuccess = ctx.ActionResult.Success
		actionError = ctx.ActionResult.Error
		logEntry["action_success"] = ctx.ActionResult.Success
		logEntry["action_error"] = ctx.ActionResult.Error
		if l.config.LogDuration {
			logEntry["action_duration_ms"] = ctx.ActionResult.Duration.Milliseconds()
		}
		logEntry["stop_pipeline"] = ctx.ActionResult.StopPipeline

		if l.config.LogOutput && ctx.ActionResult.Data != nil {
			outputStr := l.truncateData(ctx.ActionResult.Data)
			logEntry["action_output"] = outputStr
			actionResult = outputStr
		}
	}

	// 记录到控制台
	l.log(logEntry)

	// 持久化到数据库 - 环绕型拦截器只在 after 阶段写一条完整记录
	// phase 设为 "around" 表示这是一条完整的环绕日志
	l.saveToDatabaseAround(ctx, beforeStartTime, actionSuccess, actionError, actionResult)

	return &interceptor.InterceptorResult{
		Decision:      interceptor.DecisionContinue,
		Success:       true,
		ExecutionTime: time.Since(afterStartTime),
		Data: map[string]interface{}{
			"logged":    true,
			"phase":     "after",
			"timestamp": time.Now().Format(time.RFC3339),
		},
	}, nil
}

// CanIntercept 检查是否可以拦截此动作
func (l *LoggingInterceptor) CanIntercept(action *interceptor.ActionInfo, phase interceptor.Phase) bool {
	// 日志拦截器拦截所有动作
	return true
}

// buildLogEntry 构建日志条目
func (l *LoggingInterceptor) buildLogEntry(ctx *interceptor.InterceptorContext, phase string) map[string]interface{} {
	entry := map[string]interface{}{
		"timestamp":  time.Now().Format(time.RFC3339),
		"phase":      phase,
		"trigger_id": ctx.TriggerID,
	}

	// 动作信息
	if ctx.Action != nil {
		entry["action_id"] = ctx.Action.ID
		entry["action_plugin_id"] = ctx.Action.PluginID
		entry["action_plugin_name"] = ctx.Action.PluginName
		entry["action_order"] = ctx.Action.ExecutionOrder
		entry["action_depth"] = ctx.Action.Depth

		if l.config.LogActionConfig && ctx.Action.Config != nil {
			configStr := l.truncateData(ctx.Action.Config)
			entry["action_config"] = configStr
		}
	}

	// 邮件信息
	if ctx.Email != nil {
		entry["email_id"] = ctx.Email.ID
		entry["email_subject"] = l.truncateString(ctx.Email.Subject, 200)
		if len(ctx.Email.From) > 0 {
			entry["email_from"] = ctx.Email.From[0]
		}
	}

	// 变量上下文
	if l.config.LogVariables && ctx.Event != nil && ctx.Event.Variables != nil {
		varsStr := l.truncateData(ctx.Event.Variables)
		entry["variables"] = varsStr
	}

	return entry
}

// log 记录日志
func (l *LoggingInterceptor) log(entry map[string]interface{}) {
	jsonBytes, err := json.Marshal(entry)
	if err != nil {
		log.Printf("[LoggingInterceptor] Failed to marshal log entry: %v", err)
		return
	}

	// 根据日志级别输出
	switch l.config.LogLevel {
	case "debug":
		log.Printf("[LoggingInterceptor][DEBUG] %s", string(jsonBytes))
	case "info":
		log.Printf("[LoggingInterceptor][INFO] %s", string(jsonBytes))
	case "warn":
		log.Printf("[LoggingInterceptor][WARN] %s", string(jsonBytes))
	case "error":
		log.Printf("[LoggingInterceptor][ERROR] %s", string(jsonBytes))
	default:
		log.Printf("[LoggingInterceptor][INFO] %s", string(jsonBytes))
	}
}

// saveToDatabase 保存日志到数据库
func (l *LoggingInterceptor) saveToDatabase(ctx *interceptor.InterceptorContext, phase string, startTime time.Time, success bool, errorMsg string, actionResult string) {
	if l.saveCallback == nil {
		// 未设置回调，跳过持久化
		return
	}

	// 构建日志记录
	logEntry := &models.InterceptorLog{
		InterceptorID:   ctx.InterceptorID,
		InterceptorName: ctx.InterceptorName,
		Phase:           phase,
		Success:         success,
		Error:           errorMsg,
		Duration:        time.Since(startTime).Milliseconds(),
		ActionResult:    actionResult,
		CreatedAt:       time.Now(),
	}

	// 设置动作信息
	if ctx.Action != nil {
		logEntry.ActionID = ctx.Action.ID
		logEntry.ActionPluginID = ctx.Action.PluginID
	}

	// 设置触发器ID
	if ctx.TriggerID > 0 {
		triggerID := ctx.TriggerID
		logEntry.TriggerID = &triggerID
	}

	// 设置邮件ID
	if ctx.Email != nil && ctx.Email.ID > 0 {
		emailID := ctx.Email.ID
		logEntry.EmailID = &emailID
	}

	// 设置输入数据
	if l.config.LogInput && ctx.Action != nil && ctx.Action.Config != nil {
		inputData := l.truncateData(ctx.Action.Config)
		logEntry.InputData = inputData
	}

	// 保存到数据库
	if err := l.saveCallback(logEntry); err != nil {
		log.Printf("[LoggingInterceptor] Failed to save log to database: %v", err)
	}
}

// saveToDatabaseAround 保存环绕型拦截器的完整日志
// 用于 around 类型拦截器，在 after 阶段记录一条包含完整执行周期的日志
func (l *LoggingInterceptor) saveToDatabaseAround(ctx *interceptor.InterceptorContext, beforeStartTime time.Time, success bool, errorMsg string, actionResult string) {
	if l.saveCallback == nil {
		// 未设置回调，跳过持久化
		return
	}

	// 计算从 before 开始到现在的总时长
	totalDuration := time.Since(beforeStartTime).Milliseconds()

	// 构建日志记录 - phase 设为 "around" 表示完整的环绕执行
	logEntry := &models.InterceptorLog{
		InterceptorID:   ctx.InterceptorID,
		InterceptorName: ctx.InterceptorName,
		Phase:           "around", // 环绕类型
		Success:         success,
		Error:           errorMsg,
		Duration:        totalDuration,
		ActionResult:    actionResult,
		CreatedAt:       time.Now(),
	}

	// 设置动作信息
	if ctx.Action != nil {
		logEntry.ActionID = ctx.Action.ID
		logEntry.ActionPluginID = ctx.Action.PluginID
	}

	// 设置触发器ID
	if ctx.TriggerID > 0 {
		triggerID := ctx.TriggerID
		logEntry.TriggerID = &triggerID
	}

	// 设置邮件ID
	if ctx.Email != nil && ctx.Email.ID > 0 {
		emailID := ctx.Email.ID
		logEntry.EmailID = &emailID
	}

	// 设置输入数据
	if l.config.LogInput && ctx.Action != nil && ctx.Action.Config != nil {
		inputData := l.truncateData(ctx.Action.Config)
		logEntry.InputData = inputData
	}

	// 设置输出数据
	if l.config.LogOutput && actionResult != "" {
		logEntry.OutputData = actionResult
	}

	// 保存到数据库
	if err := l.saveCallback(logEntry); err != nil {
		log.Printf("[LoggingInterceptor] Failed to save around log to database: %v", err)
	}
}

// truncateData 截断数据
func (l *LoggingInterceptor) truncateData(data interface{}) string {
	jsonBytes, err := json.Marshal(data)
	if err != nil {
		return fmt.Sprintf("<marshal error: %v>", err)
	}
	return l.truncateString(string(jsonBytes), l.config.MaxDataLength)
}

// truncateString 截断字符串
func (l *LoggingInterceptor) truncateString(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "...[truncated]"
}
