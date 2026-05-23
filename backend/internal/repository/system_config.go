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
