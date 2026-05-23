package services

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	"mailman/internal/models"
)

// TriggerTemplate 触发器模板
type TriggerTemplate struct {
	ID          string                     `json:"id"`
	Name        string                     `json:"name"`
	Description string                     `json:"description"`
	Category    string                     `json:"category"`
	Version     string                     `json:"version"`
	Author      string                     `json:"author"`
	CreatedAt   time.Time                  `json:"created_at"`
	UpdatedAt   time.Time                  `json:"updated_at"`
	Expressions []models.TriggerExpression `json:"expressions"`
	Actions     []models.TriggerAction     `json:"actions"`
	Tags        []string                   `json:"tags"`
	Icon        string                     `json:"icon"`
	Metadata    map[string]interface{}     `json:"metadata"`
}

// TriggerTemplateManager 管理触发器模板
type TriggerTemplateManager struct {
	templateDirs []string
	templates    map[string]*TriggerTemplate
	mutex        sync.RWMutex
}

// NewTriggerTemplateManager 创建一个新的触发器模板管理器
func NewTriggerTemplateManager(templateDirs []string) *TriggerTemplateManager {
	return &TriggerTemplateManager{
		templateDirs: templateDirs,
		templates:    make(map[string]*TriggerTemplate),
	}
}

// LoadTemplates 从指定目录加载所有模板
func (m *TriggerTemplateManager) LoadTemplates() error {
	m.mutex.Lock()
	defer m.mutex.Unlock()

	// 清除现有模板
	m.templates = make(map[string]*TriggerTemplate)

	for _, dir := range m.templateDirs {
		log.Printf("[TriggerTemplateManager] Loading templates from directory: %s", dir)

		// 确保目录存在
		if _, err := os.Stat(dir); os.IsNotExist(err) {
			log.Printf("[TriggerTemplateManager] Directory does not exist: %s", dir)
			continue
		}

		// 遍历目录中的所有文件
		files, err := os.ReadDir(dir)
		if err != nil {
			log.Printf("[TriggerTemplateManager] Error reading directory %s: %v", dir, err)
			continue
		}

		// 加载每个模板文件
		for _, file := range files {
			if file.IsDir() || filepath.Ext(file.Name()) != ".json" {
				continue
			}

			templatePath := filepath.Join(dir, file.Name())

			// 加载模板
			template, err := m.loadTemplateFromFile(templatePath)
			if err != nil {
				log.Printf("[TriggerTemplateManager] Error loading template %s: %v", templatePath, err)
				continue
			}

			// 存储模板
			m.templates[template.ID] = template
			log.Printf("[TriggerTemplateManager] Loaded template: %s (%s)", template.ID, template.Name)
		}
	}

	log.Printf("[TriggerTemplateManager] Loaded %d templates", len(m.templates))
	return nil
}

// loadTemplateFromFile 从文件加载模板
func (m *TriggerTemplateManager) loadTemplateFromFile(path string) (*TriggerTemplate, error) {
	// 读取模板文件
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read template file: %v", err)
	}

	// 解析模板
	var template TriggerTemplate
	if err := json.Unmarshal(data, &template); err != nil {
		return nil, fmt.Errorf("failed to parse template: %v", err)
	}

	// 验证必要字段
	if template.ID == "" {
		return nil, fmt.Errorf("template ID is required")
	}
	if template.Name == "" {
		return nil, fmt.Errorf("template name is required")
	}

	return &template, nil
}

// GetTemplate 获取指定ID的模板
func (m *TriggerTemplateManager) GetTemplate(id string) (*TriggerTemplate, error) {
	m.mutex.RLock()
	defer m.mutex.RUnlock()

	template, exists := m.templates[id]
	if !exists {
		return nil, fmt.Errorf("template not found: %s", id)
	}

	return template, nil
}

// GetAllTemplates 获取所有模板
func (m *TriggerTemplateManager) GetAllTemplates() []*TriggerTemplate {
	m.mutex.RLock()
	defer m.mutex.RUnlock()

	templates := make([]*TriggerTemplate, 0, len(m.templates))
	for _, template := range m.templates {
		templates = append(templates, template)
	}

	return templates
}

// GetTemplatesByCategory 获取指定类别的模板
func (m *TriggerTemplateManager) GetTemplatesByCategory(category string) []*TriggerTemplate {
	m.mutex.RLock()
	defer m.mutex.RUnlock()

	templates := make([]*TriggerTemplate, 0)
	for _, template := range m.templates {
		if template.Category == category {
			templates = append(templates, template)
		}
	}

	return templates
}

// GetTemplatesByTag 获取包含指定标签的模板
func (m *TriggerTemplateManager) GetTemplatesByTag(tag string) []*TriggerTemplate {
	m.mutex.RLock()
	defer m.mutex.RUnlock()

	templates := make([]*TriggerTemplate, 0)
	for _, template := range m.templates {
		for _, t := range template.Tags {
			if t == tag {
				templates = append(templates, template)
				break
			}
		}
	}

	return templates
}

// SaveTemplate 保存模板到文件
func (m *TriggerTemplateManager) SaveTemplate(template *TriggerTemplate) error {
	if len(m.templateDirs) == 0 {
		return fmt.Errorf("no template directories configured")
	}

	// 使用第一个目录作为保存位置
	dir := m.templateDirs[0]

	// 确保目录存在
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create template directory: %v", err)
	}

	// 更新时间戳
	template.UpdatedAt = time.Now()
	if template.CreatedAt.IsZero() {
		template.CreatedAt = template.UpdatedAt
	}

	// 序列化模板
	data, err := json.MarshalIndent(template, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to serialize template: %v", err)
	}

	// 保存到文件
	path := filepath.Join(dir, template.ID+".json")
	if err := os.WriteFile(path, data, 0644); err != nil {
		return fmt.Errorf("failed to write template file: %v", err)
	}

	// 更新内存中的模板
	m.mutex.Lock()
	m.templates[template.ID] = template
	m.mutex.Unlock()

	log.Printf("[TriggerTemplateManager] Saved template: %s (%s)", template.ID, template.Name)
	return nil
}

// DeleteTemplate 删除模板
func (m *TriggerTemplateManager) DeleteTemplate(id string) error {
	m.mutex.Lock()
	defer m.mutex.Unlock()

	// 检查模板是否存在
	_, exists := m.templates[id]
	if !exists {
		return fmt.Errorf("template not found: %s", id)
	}

	// 从内存中删除
	delete(m.templates, id)

	// 从文件系统中删除
	for _, dir := range m.templateDirs {
		path := filepath.Join(dir, id+".json")
		if _, err := os.Stat(path); err == nil {
			if err := os.Remove(path); err != nil {
				log.Printf("[TriggerTemplateManager] Error deleting template file %s: %v", path, err)
			} else {
				log.Printf("[TriggerTemplateManager] Deleted template file: %s", path)
			}
		}
	}

	log.Printf("[TriggerTemplateManager] Deleted template: %s", id)
	return nil
}

// CreateTriggerFromTemplate 从模板创建触发器
func (m *TriggerTemplateManager) CreateTriggerFromTemplate(templateID string) (*models.EmailTriggerV2, error) {
	// 获取模板
	template, err := m.GetTemplate(templateID)
	if err != nil {
		return nil, err
	}

	// 创建触发器
	trigger := &models.EmailTriggerV2{
		Name:        template.Name,
		Description: template.Description,
		Enabled:     false, // 默认禁用
		Expressions: template.Expressions,
		Actions:     template.Actions,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}

	return trigger, nil
}
