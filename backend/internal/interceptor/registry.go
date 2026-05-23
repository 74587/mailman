package interceptor

import (
	"fmt"
	"log"
	"sort"
	"sync"
	"time"

	"mailman/internal/models"
)

// Registry 拦截器注册表（支持热更新）
type Registry struct {
	mu            sync.RWMutex
	version       int64                         // 配置版本号
	plugins       map[string]InterceptorPlugin  // 插件映射
	globalConfigs []*InterceptorConfig          // 全局拦截器配置
	localConfigs  map[uint][]*InterceptorConfig // 局部拦截器配置 (key: triggerID)
	subscribers   []chan struct{}               // 配置变更订阅者
}

// NewRegistry 创建拦截器注册表
func NewRegistry() *Registry {
	return &Registry{
		version:       0,
		plugins:       make(map[string]InterceptorPlugin),
		globalConfigs: make([]*InterceptorConfig, 0),
		localConfigs:  make(map[uint][]*InterceptorConfig),
		subscribers:   make([]chan struct{}, 0),
	}
}

// RegisterPlugin 注册拦截器插件
func (r *Registry) RegisterPlugin(plugin InterceptorPlugin) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	info := plugin.GetInfo()
	if info == nil {
		return fmt.Errorf("plugin info is nil")
	}

	if _, exists := r.plugins[info.ID]; exists {
		return fmt.Errorf("plugin %s already registered", info.ID)
	}

	// 初始化插件
	if err := plugin.OnLoad(); err != nil {
		return fmt.Errorf("failed to load plugin %s: %w", info.ID, err)
	}

	r.plugins[info.ID] = plugin
	log.Printf("[InterceptorRegistry] Registered plugin: %s (v%s)", info.ID, info.Version)
	return nil
}

// UnregisterPlugin 注销拦截器插件
func (r *Registry) UnregisterPlugin(pluginID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	plugin, exists := r.plugins[pluginID]
	if !exists {
		return fmt.Errorf("plugin %s not found", pluginID)
	}

	// 卸载插件
	if err := plugin.OnUnload(); err != nil {
		log.Printf("[InterceptorRegistry] Warning: plugin %s unload error: %v", pluginID, err)
	}

	delete(r.plugins, pluginID)
	log.Printf("[InterceptorRegistry] Unregistered plugin: %s", pluginID)
	return nil
}

// GetPlugin 获取插件
func (r *Registry) GetPlugin(pluginID string) (InterceptorPlugin, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	plugin, exists := r.plugins[pluginID]
	if !exists {
		return nil, fmt.Errorf("plugin %s not found", pluginID)
	}
	return plugin, nil
}

// ListPlugins 列出所有插件信息
func (r *Registry) ListPlugins() ([]*models.InterceptorPluginInfo, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	result := make([]*models.InterceptorPluginInfo, 0, len(r.plugins))
	for _, plugin := range r.plugins {
		info := plugin.GetInfo()
		phases := plugin.GetSupportedPhases()
		pluginType := plugin.GetType()

		supportsBefore := false
		supportsAfter := false
		for _, p := range phases {
			if p == PhaseBefore {
				supportsBefore = true
			}
			if p == PhaseAfter {
				supportsAfter = true
			}
		}

		result = append(result, &models.InterceptorPluginInfo{
			ID:             info.ID,
			Name:           info.Name,
			Description:    info.Description,
			Version:        info.Version,
			Type:           string(pluginType), // 添加类型
			SupportsBefore: supportsBefore,
			SupportsAfter:  supportsAfter,
			ConfigSchema:   info.ConfigSchema,
			DefaultConfig:  info.DefaultConfig,
		})
	}
	return result, nil
}

// GetSnapshot 获取当前配置快照（用于任务执行）
func (r *Registry) GetSnapshot() *InterceptorSnapshot {
	r.mu.RLock()
	defer r.mu.RUnlock()

	// 创建深拷贝
	globalCopy := make([]*InterceptorConfig, len(r.globalConfigs))
	copy(globalCopy, r.globalConfigs)

	localCopy := make(map[uint][]*InterceptorConfig)
	for k, v := range r.localConfigs {
		localCopy[k] = make([]*InterceptorConfig, len(v))
		copy(localCopy[k], v)
	}

	return &InterceptorSnapshot{
		Version:       r.version,
		GlobalConfigs: globalCopy,
		LocalConfigs:  localCopy,
		CreatedAt:     time.Now(),
	}
}

// UpdateConfig 更新拦截器配置（热更新）
func (r *Registry) UpdateConfig(config *InterceptorConfig) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	// 验证插件是否存在
	if _, exists := r.plugins[config.PluginID]; !exists {
		return fmt.Errorf("plugin %s not found", config.PluginID)
	}

	// 根据作用域更新配置
	if config.Scope == models.InterceptorScopeGlobal {
		r.updateGlobalConfig(config)
	} else {
		r.updateLocalConfig(config)
	}

	// 更新版本号
	r.version++
	log.Printf("[InterceptorRegistry] Config updated: %s (ID: %d), version: %d", config.Name, config.ID, r.version)

	// 通知订阅者
	r.notifySubscribers()

	return nil
}

// updateGlobalConfig 更新全局配置
func (r *Registry) updateGlobalConfig(config *InterceptorConfig) {
	// 查找并更新或添加
	found := false
	for i, cfg := range r.globalConfigs {
		if cfg.ID == config.ID {
			r.globalConfigs[i] = config
			found = true
			break
		}
	}
	if !found {
		r.globalConfigs = append(r.globalConfigs, config)
	}

	// 按 order 排序
	sort.Slice(r.globalConfigs, func(i, j int) bool {
		return r.globalConfigs[i].Order < r.globalConfigs[j].Order
	})
}

// updateLocalConfig 更新局部配置
func (r *Registry) updateLocalConfig(config *InterceptorConfig) {
	var key uint
	if config.TriggerID != nil {
		key = *config.TriggerID
	} else if config.ExtractorID != nil {
		key = *config.ExtractorID
	} else {
		log.Printf("[InterceptorRegistry] Warning: local config %d has no trigger/extractor ID", config.ID)
		return
	}

	configs := r.localConfigs[key]
	found := false
	for i, cfg := range configs {
		if cfg.ID == config.ID {
			configs[i] = config
			found = true
			break
		}
	}
	if !found {
		configs = append(configs, config)
	}

	// 按 order 排序
	sort.Slice(configs, func(i, j int) bool {
		return configs[i].Order < configs[j].Order
	})

	r.localConfigs[key] = configs
}

// RemoveConfig 移除拦截器配置
func (r *Registry) RemoveConfig(id uint) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	// 从全局配置中移除
	for i, cfg := range r.globalConfigs {
		if cfg.ID == id {
			r.globalConfigs = append(r.globalConfigs[:i], r.globalConfigs[i+1:]...)
			r.version++
			r.notifySubscribers()
			log.Printf("[InterceptorRegistry] Removed global config: %d, version: %d", id, r.version)
			return nil
		}
	}

	// 从局部配置中移除
	for key, configs := range r.localConfigs {
		for i, cfg := range configs {
			if cfg.ID == id {
				r.localConfigs[key] = append(configs[:i], configs[i+1:]...)
				r.version++
				r.notifySubscribers()
				log.Printf("[InterceptorRegistry] Removed local config: %d, version: %d", id, r.version)
				return nil
			}
		}
	}

	return fmt.Errorf("config %d not found", id)
}

// ReloadConfigs 重新加载所有配置
func (r *Registry) ReloadConfigs() error {
	// 此方法由外部调用，传入从数据库加载的配置
	// 实际实现需要注入数据库依赖
	log.Printf("[InterceptorRegistry] ReloadConfigs called - should be implemented with DB dependency")
	return nil
}

// LoadConfigs 加载配置列表（由外部调用）
func (r *Registry) LoadConfigs(configs []*InterceptorConfig) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	// 清空现有配置
	r.globalConfigs = make([]*InterceptorConfig, 0)
	r.localConfigs = make(map[uint][]*InterceptorConfig)

	// 加载新配置
	for _, config := range configs {
		if config.Scope == models.InterceptorScopeGlobal {
			r.globalConfigs = append(r.globalConfigs, config)
		} else {
			var key uint
			if config.TriggerID != nil {
				key = *config.TriggerID
			} else if config.ExtractorID != nil {
				key = *config.ExtractorID
			} else {
				continue
			}
			r.localConfigs[key] = append(r.localConfigs[key], config)
		}
	}

	// 排序
	sort.Slice(r.globalConfigs, func(i, j int) bool {
		return r.globalConfigs[i].Order < r.globalConfigs[j].Order
	})
	for key := range r.localConfigs {
		configs := r.localConfigs[key]
		sort.Slice(configs, func(i, j int) bool {
			return configs[i].Order < configs[j].Order
		})
	}

	r.version++
	r.notifySubscribers()
	log.Printf("[InterceptorRegistry] Loaded %d global configs, %d trigger local configs, version: %d",
		len(r.globalConfigs), len(r.localConfigs), r.version)

	return nil
}

// Subscribe 订阅配置变更
func (r *Registry) Subscribe(ch chan struct{}) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.subscribers = append(r.subscribers, ch)
}

// Unsubscribe 取消订阅
func (r *Registry) Unsubscribe(ch chan struct{}) {
	r.mu.Lock()
	defer r.mu.Unlock()

	for i, sub := range r.subscribers {
		if sub == ch {
			r.subscribers = append(r.subscribers[:i], r.subscribers[i+1:]...)
			return
		}
	}
}

// notifySubscribers 通知所有订阅者
func (r *Registry) notifySubscribers() {
	for _, ch := range r.subscribers {
		select {
		case ch <- struct{}{}:
		default:
			// 非阻塞发送，避免死锁
		}
	}
}

// GetVersion 获取当前版本号
func (r *Registry) GetVersion() int64 {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.version
}

// GetGlobalConfigCount 获取全局配置数量
func (r *Registry) GetGlobalConfigCount() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.globalConfigs)
}
