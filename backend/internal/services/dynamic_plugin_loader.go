package services

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"plugin"
	"sync"
	"time"
)

// DynamicPluginLoader 负责动态加载插件
type DynamicPluginLoader struct {
	pluginManager    *PluginManager
	pluginDirs       []string
	loadedPlugins    map[string]Plugin
	pluginSources    map[string]string // 插件ID到插件文件路径的映射
	mutex            sync.RWMutex
	watchInterval    int // 监视间隔（秒）
	stopWatcher      chan struct{}
	isWatcherRunning bool
}

// PluginMetadata 插件元数据
type PluginMetadata struct {
	ID          string                 `json:"id"`
	Name        string                 `json:"name"`
	Description string                 `json:"description"`
	Version     string                 `json:"version"`
	Author      string                 `json:"author"`
	Config      map[string]interface{} `json:"config"`
}

// NewDynamicPluginLoader 创建一个新的动态插件加载器
func NewDynamicPluginLoader(pluginManager *PluginManager, pluginDirs []string) *DynamicPluginLoader {
	return &DynamicPluginLoader{
		pluginManager:    pluginManager,
		pluginDirs:       pluginDirs,
		loadedPlugins:    make(map[string]Plugin),
		pluginSources:    make(map[string]string),
		watchInterval:    30, // 默认30秒检查一次
		stopWatcher:      make(chan struct{}),
		isWatcherRunning: false,
	}
}

// LoadPlugins 从指定目录加载所有插件
func (l *DynamicPluginLoader) LoadPlugins() error {
	l.mutex.Lock()
	defer l.mutex.Unlock()

	for _, dir := range l.pluginDirs {
		log.Printf("[DynamicPluginLoader] Loading plugins from directory: %s", dir)

		// 确保目录存在
		if _, err := os.Stat(dir); os.IsNotExist(err) {
			log.Printf("[DynamicPluginLoader] Directory does not exist: %s", dir)
			continue
		}

		// 遍历目录中的所有文件
		files, err := os.ReadDir(dir)
		if err != nil {
			log.Printf("[DynamicPluginLoader] Error reading directory %s: %v", dir, err)
			continue
		}

		// 加载每个插件文件
		for _, file := range files {
			if file.IsDir() || filepath.Ext(file.Name()) != ".so" {
				continue
			}

			pluginPath := filepath.Join(dir, file.Name())
			metadataPath := filepath.Join(dir, file.Name()+".json")

			// 检查是否有元数据文件
			metadata, err := l.loadPluginMetadata(metadataPath)
			if err != nil {
				log.Printf("[DynamicPluginLoader] Error loading plugin metadata %s: %v", metadataPath, err)
				continue
			}

			// 加载插件
			if err := l.loadPlugin(pluginPath, metadata); err != nil {
				log.Printf("[DynamicPluginLoader] Error loading plugin %s: %v", pluginPath, err)
				continue
			}
		}
	}

	return nil
}

// loadPluginMetadata 加载插件元数据
func (l *DynamicPluginLoader) loadPluginMetadata(path string) (*PluginMetadata, error) {
	// 检查元数据文件是否存在
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return nil, fmt.Errorf("metadata file not found: %s", path)
	}

	// 读取元数据文件
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read metadata file: %v", err)
	}

	// 解析元数据
	var metadata PluginMetadata
	if err := json.Unmarshal(data, &metadata); err != nil {
		return nil, fmt.Errorf("failed to parse metadata: %v", err)
	}

	// 验证必要字段
	if metadata.ID == "" {
		return nil, fmt.Errorf("plugin ID is required in metadata")
	}
	if metadata.Name == "" {
		return nil, fmt.Errorf("plugin name is required in metadata")
	}

	return &metadata, nil
}

// loadPlugin 加载单个插件
func (l *DynamicPluginLoader) loadPlugin(path string, metadata *PluginMetadata) error {
	// 检查插件是否已加载
	if _, exists := l.loadedPlugins[metadata.ID]; exists {
		log.Printf("[DynamicPluginLoader] Plugin %s already loaded, skipping", metadata.ID)
		return nil
	}

	// 打开插件文件
	plug, err := plugin.Open(path)
	if err != nil {
		return fmt.Errorf("failed to open plugin: %v", err)
	}

	// 查找插件的New函数
	newFunc, err := plug.Lookup("New")
	if err != nil {
		return fmt.Errorf("failed to find New function: %v", err)
	}

	// 检查函数类型
	newPluginFunc, ok := newFunc.(func() Plugin)
	if !ok {
		return fmt.Errorf("New function has wrong signature")
	}

	// 创建插件实例
	pluginInstance := newPluginFunc()

	// 注册插件
	l.pluginManager.RegisterPlugin(metadata.ID, pluginInstance)
	l.loadedPlugins[metadata.ID] = pluginInstance
	l.pluginSources[metadata.ID] = path

	log.Printf("[DynamicPluginLoader] Successfully loaded plugin: %s (%s)", metadata.ID, metadata.Name)
	return nil
}

// UnloadPlugin 卸载插件
func (l *DynamicPluginLoader) UnloadPlugin(pluginID string) error {
	l.mutex.Lock()
	defer l.mutex.Unlock()

	// 检查插件是否已加载
	if _, exists := l.loadedPlugins[pluginID]; !exists {
		return fmt.Errorf("plugin not loaded: %s", pluginID)
	}

	// 从映射中删除插件
	delete(l.loadedPlugins, pluginID)
	delete(l.pluginSources, pluginID)

	log.Printf("[DynamicPluginLoader] Unloaded plugin: %s", pluginID)
	return nil
}

// ReloadPlugin 重新加载插件
func (l *DynamicPluginLoader) ReloadPlugin(pluginID string) error {
	// 获取插件源文件路径
	l.mutex.RLock()
	path, exists := l.pluginSources[pluginID]
	l.mutex.RUnlock()

	if !exists {
		return fmt.Errorf("plugin source not found: %s", pluginID)
	}

	// 卸载插件
	if err := l.UnloadPlugin(pluginID); err != nil {
		return fmt.Errorf("failed to unload plugin: %v", err)
	}

	// 加载元数据
	metadataPath := path + ".json"
	metadata, err := l.loadPluginMetadata(metadataPath)
	if err != nil {
		return fmt.Errorf("failed to load plugin metadata: %v", err)
	}

	// 重新加载插件
	if err := l.loadPlugin(path, metadata); err != nil {
		return fmt.Errorf("failed to reload plugin: %v", err)
	}

	log.Printf("[DynamicPluginLoader] Successfully reloaded plugin: %s", pluginID)
	return nil
}

// StartWatcher 启动插件目录监视器
func (l *DynamicPluginLoader) StartWatcher() {
	l.mutex.Lock()
	if l.isWatcherRunning {
		l.mutex.Unlock()
		return
	}
	l.isWatcherRunning = true
	l.mutex.Unlock()

	go func() {
		ticker := time.NewTicker(time.Duration(l.watchInterval) * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-ticker.C:
				l.checkForPluginChanges()
			case <-l.stopWatcher:
				log.Println("[DynamicPluginLoader] Stopping plugin watcher")
				return
			}
		}
	}()

	log.Printf("[DynamicPluginLoader] Started plugin watcher (interval: %d seconds)", l.watchInterval)
}

// StopWatcher 停止插件目录监视器
func (l *DynamicPluginLoader) StopWatcher() {
	l.mutex.Lock()
	defer l.mutex.Unlock()

	if l.isWatcherRunning {
		l.stopWatcher <- struct{}{}
		l.isWatcherRunning = false
	}
}

// SetWatchInterval 设置监视间隔
func (l *DynamicPluginLoader) SetWatchInterval(seconds int) {
	if seconds <= 0 {
		seconds = 30 // 默认值
	}

	l.mutex.Lock()
	defer l.mutex.Unlock()
	l.watchInterval = seconds
}

// checkForPluginChanges 检查插件目录中的变化
func (l *DynamicPluginLoader) checkForPluginChanges() {
	// 记录当前已知的插件
	l.mutex.RLock()
	knownPlugins := make(map[string]bool)
	for id := range l.loadedPlugins {
		knownPlugins[id] = true
	}
	l.mutex.RUnlock()

	// 扫描目录查找新插件
	for _, dir := range l.pluginDirs {
		files, err := os.ReadDir(dir)
		if err != nil {
			log.Printf("[DynamicPluginLoader] Error reading directory %s: %v", dir, err)
			continue
		}

		for _, file := range files {
			if file.IsDir() || filepath.Ext(file.Name()) != ".so" {
				continue
			}

			pluginPath := filepath.Join(dir, file.Name())
			metadataPath := filepath.Join(dir, file.Name()+".json")

			// 检查是否有元数据文件
			metadata, err := l.loadPluginMetadata(metadataPath)
			if err != nil {
				continue
			}

			// 检查插件是否已加载
			l.mutex.RLock()
			_, exists := l.loadedPlugins[metadata.ID]
			l.mutex.RUnlock()

			if !exists {
				// 加载新插件
				l.mutex.Lock()
				err := l.loadPlugin(pluginPath, metadata)
				l.mutex.Unlock()
				if err != nil {
					log.Printf("[DynamicPluginLoader] Error loading new plugin %s: %v", pluginPath, err)
				} else {
					log.Printf("[DynamicPluginLoader] Loaded new plugin: %s", metadata.ID)
				}
			} else {
				// 标记为已检查
				delete(knownPlugins, metadata.ID)
			}
		}
	}

	// 检查是否有插件被删除
	for id := range knownPlugins {
		l.mutex.RLock()
		path, exists := l.pluginSources[id]
		l.mutex.RUnlock()

		if exists {
			// 检查文件是否仍然存在
			if _, err := os.Stat(path); os.IsNotExist(err) {
				// 插件文件已被删除，卸载插件
				l.UnloadPlugin(id)
				log.Printf("[DynamicPluginLoader] Plugin file removed, unloaded plugin: %s", id)
			}
		}
	}
}

// GetLoadedPlugins 获取已加载的插件列表
func (l *DynamicPluginLoader) GetLoadedPlugins() []string {
	l.mutex.RLock()
	defer l.mutex.RUnlock()

	plugins := make([]string, 0, len(l.loadedPlugins))
	for id := range l.loadedPlugins {
		plugins = append(plugins, id)
	}

	return plugins
}
