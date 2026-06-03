package builtin

import (
	"fmt"
	"mailman/internal/triggerv2/plugins"
)

type pluginManagerAware interface {
	SetPluginManager(plugins.PluginManager)
}

// GetBuiltinPlugins 获取所有内置插件
func GetBuiltinPlugins() []plugins.Plugin {
	return []plugins.Plugin{
		// 特殊条件插件
		NewAlwaysPassPlugin(), // 始终通过 - 不过滤任何邮件

		// 现有的内置插件
		NewEmailConditionPlugin(),
		NewEmailFilterPlugin(),
		NewNotificationActionPlugin(),

		// 新增的邮件条件插件
		NewEmailAccountSetPlugin(),
		NewEmailPrefixPlugin(),
		NewEmailSuffixPlugin(),
		NewEmailTimeRangePlugin(),
		NewEmailSizePlugin(),
		NewEmailHeaderFilterPlugin(),
		NewEmailAttachmentFilterPlugin(),
		NewEmailSecurityFilterPlugin(),

		// 新增的邮件动作插件
		NewEmailForwardActionPlugin(),
		NewEmailDeleteActionPlugin(),
		NewEmailLabelActionPlugin(),
		NewEmailTransformActionPlugin(),   // 已废弃，保留兼容
		NewEmailTransformActionV2Plugin(), // 新版，支持多规则和变量

		// 第三方服务动作插件
		NewTelegramBotActionPlugin(),
		NewWebhookActionPlugin(),

		// AI 处理动作插件
		NewAIProcessActionPlugin(),

		// 高级组合动作插件
		NewVariableExtractActionPlugin(),   // 变量提取
		NewConditionalBranchActionPlugin(), // 条件分支
		NewParallelActionsPlugin(),         // 并行动作

		// 流程控制动作插件
		NewReturnActionPlugin(), // 中断流程
	}
}

// RegisterBuiltinPlugins 注册所有内置插件到管理器
func RegisterBuiltinPlugins(manager plugins.PluginManager) error {
	builtinPlugins := GetBuiltinPlugins()

	for _, plugin := range builtinPlugins {
		ApplyBuiltinPluginPolicy(plugin.GetInfo())
		if aware, ok := plugin.(pluginManagerAware); ok {
			aware.SetPluginManager(manager)
		}
		if err := manager.RegisterPlugin(plugin); err != nil {
			return err
		}
	}

	return nil
}

// GetBuiltinPluginByID 根据ID获取内置插件
func GetBuiltinPluginByID(id string) plugins.Plugin {
	for _, p := range GetBuiltinPlugins() {
		if p.GetInfo().ID == id {
			ApplyBuiltinPluginPolicy(p.GetInfo())
			return p
		}
	}
	return nil
}

// GetBuiltinPluginIDs 获取所有内置插件的ID列表
func GetBuiltinPluginIDs() []string {
	all := GetBuiltinPlugins()
	ids := make([]string, len(all))
	for i, p := range all {
		ids[i] = p.GetInfo().ID
	}
	return ids
}

// ValidateBuiltinPluginConfig 验证内置插件配置
func ValidateBuiltinPluginConfig(pluginID string, config map[string]interface{}) error {
	plugin := GetBuiltinPluginByID(pluginID)
	if plugin == nil {
		return fmt.Errorf("plugin not found: %s", pluginID)
	}

	return plugin.ValidateConfig(config)
}

// GetBuiltinPluginInfo 获取所有内置插件信息
func GetBuiltinPluginInfo() []*plugins.PluginInfo {
	var infos []*plugins.PluginInfo

	for _, plugin := range GetBuiltinPlugins() {
		infos = append(infos, ApplyBuiltinPluginPolicy(plugin.GetInfo()))
	}

	return infos
}

// IsBuiltinPlugin 检查是否为内置插件
func IsBuiltinPlugin(pluginID string) bool {
	for _, id := range GetBuiltinPluginIDs() {
		if id == pluginID {
			return true
		}
	}
	return false
}
