package repository

import (
	"fmt"
	"mailman/internal/models"

	"gorm.io/gorm"
)

// SystemConfigRepository 系统配置仓库
type SystemConfigRepository struct {
	db *gorm.DB
}

// NewSystemConfigRepository 创建系统配置仓库
func NewSystemConfigRepository(db *gorm.DB) *SystemConfigRepository {
	return &SystemConfigRepository{db: db}
}

// GetByKey 根据键获取配置
func (r *SystemConfigRepository) GetByKey(key string) (*models.SystemConfig, error) {
	var config models.SystemConfig
	err := r.db.Where("key = ?", key).First(&config).Error
	if err != nil {
		return nil, err
	}
	return &config, nil
}

// GetAll 获取所有可见配置
func (r *SystemConfigRepository) GetAll() ([]models.SystemConfig, error) {
	var configs []models.SystemConfig
	err := r.db.Where("is_visible = ?", true).Order("category, sort_order, name").Find(&configs).Error
	return configs, err
}

// GetByCategory 根据分类获取配置
func (r *SystemConfigRepository) GetByCategory(category string) ([]models.SystemConfig, error) {
	var configs []models.SystemConfig
	err := r.db.Where("category = ? AND is_visible = ?", category, true).Order("sort_order, name").Find(&configs).Error
	return configs, err
}

// Create 创建配置
func (r *SystemConfigRepository) Create(config *models.SystemConfig) error {
	return r.db.Create(config).Error
}

// Update 更新配置
func (r *SystemConfigRepository) Update(config *models.SystemConfig) error {
	return r.db.Save(config).Error
}

// UpdateValue 更新配置值
func (r *SystemConfigRepository) UpdateValue(key string, value interface{}) error {
	config, err := r.GetByKey(key)
	if err != nil {
		return err
	}

	if !config.IsEditable {
		return fmt.Errorf("configuration '%s' is not editable", key)
	}

	err = config.SetValue(value)
	if err != nil {
		return err
	}

	return r.Update(config)
}

// Delete 删除配置
func (r *SystemConfigRepository) Delete(key string) error {
	return r.db.Where("key = ?", key).Delete(&models.SystemConfig{}).Error
}

// InitializeDefaultConfigs 初始化默认配置
func (r *SystemConfigRepository) InitializeDefaultConfigs() error {
	defaultConfigs := []models.SystemConfig{
		{
			Key:         "developer-mode",
			Name:        "开发者模式",
			Description: "开启后将显示高级触发器、插件管理、开发者工具等高级功能。仅建议开发者使用。",
			ValueType:   models.ConfigTypeBoolean,
			DefaultValue: models.JSONMap{
				"value": "false",
			},
			Category:   "general",
			IsEditable: true,
			IsVisible:  true,
			SortOrder:  1,
		},
		{
			Key:         "oauth2-auto-open",
			Name:        "OAuth2自动打开授权窗口",
			Description: "控制是否在启动OAuth2授权时自动打开授权窗口。关闭后需要手动点击按钮或复制链接。",
			ValueType:   models.ConfigTypeBoolean,
			DefaultValue: models.JSONMap{
				"value": "true",
			},
			Category:   "oauth2",
			IsEditable: true,
			IsVisible:  true,
			SortOrder:  1,
		},
		{
			Key:         "keyboard-shortcuts-enabled",
			Name:        "启用快捷键",
			Description: "启用或禁用全局键盘快捷键功能。禁用后，所有快捷键将不会响应。",
			ValueType:   models.ConfigTypeBoolean,
			DefaultValue: models.JSONMap{
				"value": "true",
			},
			Category:   "keyboard",
			IsEditable: true,
			IsVisible:  true,
			SortOrder:  0,
		},
		{
			Key:         "business-log-settings",
			Name:        "业务日志配置",
			Description: "控制业务日志记录范围、脱敏、采样、保留时间和模块级条数限制。模块限制为0时继承全局限制，全局限制为0时不按条数裁剪。",
			ValueType:   models.ConfigTypeJSON,
			DefaultValue: models.JSONMap{
				"value": `{"enabled":true,"redactSensitive":true,"detailLevel":"summary","forceRecordFailures":true,"successSampleRate":1,"retentionDays":0,"globalLimit":0,"moduleLimits":{},"modules":{},"organizationConfigs":{},"sensitiveFields":["authorization","cookie","password","passwd","secret","token","refresh_token","access_token","api_key","apikey","credential","proxy","private_key","totp","recovery_code"],"reviewMiddlewareMode":"disabled"}`,
			},
			Category:   "observability",
			IsEditable: true,
			IsVisible:  true,
			SortOrder:  10,
		},
		{
			Key:         "output-log-settings",
			Name:        "实时日志配置",
			Description: "控制实时输出日志的内存缓冲、查询上限、流式回补和订阅数量。",
			ValueType:   models.ConfigTypeJSON,
			DefaultValue: models.JSONMap{
				"value": `{"enabled":true,"bufferLimit":5000,"queryLimitMax":2000,"streamBackfillLimit":200,"subscriberBuffer":256,"maxSubscribers":100}`,
			},
			Category:   "observability",
			IsEditable: true,
			IsVisible:  true,
			SortOrder:  11,
		},
		{
			Key:         "login-theme",
			Name:        "登录页主题",
			Description: "选择登录页面的视觉主题。classic=经典, elegant=优雅, playful=趣味互动（小玩偶）",
			ValueType:   models.ConfigTypeString,
			DefaultValue: models.JSONMap{
				"value": "classic",
			},
			Category:   "ui",
			IsEditable: true,
			IsVisible:  true,
			SortOrder:  0,
		},
		{
			Key:         "custom-theme",
			Name:        "自定义主题配置",
			Description: "保存系统自定义主题的 CSS 变量和高级 CSS。该配置由外观设置页维护。",
			ValueType:   models.ConfigTypeJSON,
			DefaultValue: models.JSONMap{
				"value": `{"name":"我的主题","variables":{"--background":"220 25% 98%","--foreground":"222 47% 11%","--card":"0 0% 100%","--card-foreground":"222 47% 11%","--popover":"0 0% 100%","--popover-foreground":"222 47% 11%","--primary":"221 83% 53%","--primary-foreground":"0 0% 100%","--secondary":"214 32% 91%","--secondary-foreground":"222 47% 11%","--muted":"214 32% 91%","--muted-foreground":"215 16% 47%","--accent":"213 94% 93%","--accent-foreground":"222 47% 11%","--border":"214 32% 91%","--input":"214 32% 91%","--ring":"221 83% 53%","--radius":"0.75rem","--sidebar-bg":"255 255 255","--sidebar-text":"71 85 105","--sidebar-text-hover":"15 23 42","--sidebar-active":"37 99 235","--sidebar-active-bg":"239 246 255","--sidebar-hover-bg":"241 245 249","--sidebar-border":"226 232 240"},"css":"/* 自定义 CSS 会在 html.custom-theme 下生效。 */\n\nhtml.custom-theme .tab-bar {\n  backdrop-filter: blur(14px);\n}\n\nhtml.custom-theme .card-hover {\n  transition: transform 180ms ease, box-shadow 180ms ease;\n}\n\nhtml.custom-theme .card-hover:hover {\n  transform: translateY(-2px);\n}"}`,
			},
			Category:   "ui",
			IsEditable: true,
			IsVisible:  false,
			SortOrder:  1,
		},
		{
			Key:         "keyboard-shortcuts",
			Name:        "快捷键配置",
			Description: "自定义键盘快捷键绑定和组合键模式设置。包括组合键模式、超时时间等配置。",
			ValueType:   models.ConfigTypeJSON,
			DefaultValue: models.JSONMap{
				"value": `{"chordMode":"visual","chordTimeout":2000,"holdThreshold":1000,"customBindings":[]}`,
			},
			Category:   "keyboard",
			IsEditable: true,
			IsVisible:  true,
			SortOrder:  1,
		},
	}

	for _, config := range defaultConfigs {
		// 检查配置是否已存在
		var existingConfig models.SystemConfig
		err := r.db.Where("key = ?", config.Key).First(&existingConfig).Error
		if err == gorm.ErrRecordNotFound {
			// 配置不存在，创建新配置
			if err := r.Create(&config); err != nil {
				return fmt.Errorf("failed to create config '%s': %v", config.Key, err)
			}
		} else if err != nil {
			return fmt.Errorf("failed to check config '%s': %v", config.Key, err)
		}
		// 配置已存在，跳过
	}

	return nil
}

// EnsureConfigExists 确保配置存在，如果不存在则创建默认配置
func (r *SystemConfigRepository) EnsureConfigExists(key string) (*models.SystemConfig, error) {
	config, err := r.GetByKey(key)
	if err == gorm.ErrRecordNotFound {
		// 尝试从默认配置中创建
		err = r.InitializeDefaultConfigs()
		if err != nil {
			return nil, fmt.Errorf("failed to initialize default configs: %v", err)
		}

		// 重新尝试获取
		config, err = r.GetByKey(key)
		if err != nil {
			return nil, fmt.Errorf("config '%s' not found even after initialization", key)
		}
	} else if err != nil {
		return nil, err
	}

	return config, nil
}

// GetValueByKey 根据键直接获取配置值
func (r *SystemConfigRepository) GetValueByKey(key string) (interface{}, error) {
	config, err := r.EnsureConfigExists(key)
	if err != nil {
		return nil, err
	}
	return config.GetValue(), nil
}

// GetBoolValueByKey 根据键获取布尔值配置
func (r *SystemConfigRepository) GetBoolValueByKey(key string) (bool, error) {
	value, err := r.GetValueByKey(key)
	if err != nil {
		return false, err
	}

	if boolVal, ok := value.(bool); ok {
		return boolVal, nil
	}

	return false, fmt.Errorf("config '%s' is not a boolean value", key)
}

// GetStringValueByKey 根据键获取字符串配置
func (r *SystemConfigRepository) GetStringValueByKey(key string) (string, error) {
	value, err := r.GetValueByKey(key)
	if err != nil {
		return "", err
	}

	if strVal, ok := value.(string); ok {
		return strVal, nil
	}

	return "", fmt.Errorf("config '%s' is not a string value", key)
}
