package services

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
)

// ConditionDefinition 条件定义
type ConditionDefinition struct {
	ID          string                 `json:"id"`
	Name        string                 `json:"name"`
	Description string                 `json:"description"`
	Category    string                 `json:"category"`
	Type        string                 `json:"type"` // "operator" 或 "function"
	Schema      map[string]interface{} `json:"schema"`
	Example     interface{}            `json:"example"`
}

// DynamicConditionLoader 动态条件加载器
type DynamicConditionLoader struct {
	conditionEngine *ConditionEngine
	conditionDirs   []string
	conditions      map[string]*ConditionDefinition
	mutex           sync.RWMutex
}

// NewDynamicConditionLoader 创建一个新的动态条件加载器
func NewDynamicConditionLoader(conditionEngine *ConditionEngine, conditionDirs []string) *DynamicConditionLoader {
	return &DynamicConditionLoader{
		conditionEngine: conditionEngine,
		conditionDirs:   conditionDirs,
		conditions:      make(map[string]*ConditionDefinition),
	}
}

// LoadConditions 从指定目录加载所有条件
func (l *DynamicConditionLoader) LoadConditions() error {
	l.mutex.Lock()
	defer l.mutex.Unlock()

	// 清除现有条件
	l.conditions = make(map[string]*ConditionDefinition)

	for _, dir := range l.conditionDirs {
		log.Printf("[DynamicConditionLoader] Loading conditions from directory: %s", dir)

		// 确保目录存在
		if _, err := os.Stat(dir); os.IsNotExist(err) {
			log.Printf("[DynamicConditionLoader] Directory does not exist: %s", dir)
			continue
		}

		// 遍历目录中的所有文件
		files, err := os.ReadDir(dir)
		if err != nil {
			log.Printf("[DynamicConditionLoader] Error reading directory %s: %v", dir, err)
			continue
		}

		// 加载每个条件文件
		for _, file := range files {
			if file.IsDir() || filepath.Ext(file.Name()) != ".json" {
				continue
			}

			conditionPath := filepath.Join(dir, file.Name())

			// 加载条件
			condition, err := l.loadConditionFromFile(conditionPath)
			if err != nil {
				log.Printf("[DynamicConditionLoader] Error loading condition %s: %v", conditionPath, err)
				continue
			}

			// 注册条件
			if err := l.registerCondition(condition); err != nil {
				log.Printf("[DynamicConditionLoader] Error registering condition %s: %v", condition.ID, err)
				continue
			}

			// 存储条件定义
			l.conditions[condition.ID] = condition
			log.Printf("[DynamicConditionLoader] Loaded condition: %s (%s)", condition.ID, condition.Name)
		}
	}

	log.Printf("[DynamicConditionLoader] Loaded %d conditions", len(l.conditions))
	return nil
}

// loadConditionFromFile 从文件加载条件
func (l *DynamicConditionLoader) loadConditionFromFile(path string) (*ConditionDefinition, error) {
	// 读取条件文件
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read condition file: %v", err)
	}

	// 解析条件
	var condition ConditionDefinition
	if err := json.Unmarshal(data, &condition); err != nil {
		return nil, fmt.Errorf("failed to parse condition: %v", err)
	}

	// 验证必要字段
	if condition.ID == "" {
		return nil, fmt.Errorf("condition ID is required")
	}
	if condition.Name == "" {
		return nil, fmt.Errorf("condition name is required")
	}
	if condition.Type != "operator" && condition.Type != "function" {
		return nil, fmt.Errorf("condition type must be 'operator' or 'function'")
	}

	return &condition, nil
}

// registerCondition 注册条件到条件引擎
func (l *DynamicConditionLoader) registerCondition(condition *ConditionDefinition) error {
	switch condition.Type {
	case "operator":
		// 创建并注册操作符
		operator := &DynamicOperator{
			id:          condition.ID,
			name:        condition.Name,
			description: condition.Description,
			schema:      condition.Schema,
		}
		l.conditionEngine.RegisterOperator(operator)
		return nil
	case "function":
		// 创建并注册函数
		function := &DynamicFunction{
			id:          condition.ID,
			name:        condition.Name,
			description: condition.Description,
			schema:      condition.Schema,
		}
		l.conditionEngine.RegisterFunction(function)
		return nil
	default:
		return fmt.Errorf("unknown condition type: %s", condition.Type)
	}
}

// GetCondition 获取指定ID的条件
func (l *DynamicConditionLoader) GetCondition(id string) (*ConditionDefinition, error) {
	l.mutex.RLock()
	defer l.mutex.RUnlock()

	condition, exists := l.conditions[id]
	if !exists {
		return nil, fmt.Errorf("condition not found: %s", id)
	}

	return condition, nil
}

// GetAllConditions 获取所有条件
func (l *DynamicConditionLoader) GetAllConditions() []*ConditionDefinition {
	l.mutex.RLock()
	defer l.mutex.RUnlock()

	conditions := make([]*ConditionDefinition, 0, len(l.conditions))
	for _, condition := range l.conditions {
		conditions = append(conditions, condition)
	}

	return conditions
}

// GetConditionsByCategory 获取指定类别的条件
func (l *DynamicConditionLoader) GetConditionsByCategory(category string) []*ConditionDefinition {
	l.mutex.RLock()
	defer l.mutex.RUnlock()

	conditions := make([]*ConditionDefinition, 0)
	for _, condition := range l.conditions {
		if condition.Category == category {
			conditions = append(conditions, condition)
		}
	}

	return conditions
}

// GetConditionsByType 获取指定类型的条件
func (l *DynamicConditionLoader) GetConditionsByType(conditionType string) []*ConditionDefinition {
	l.mutex.RLock()
	defer l.mutex.RUnlock()

	conditions := make([]*ConditionDefinition, 0)
	for _, condition := range l.conditions {
		if condition.Type == conditionType {
			conditions = append(conditions, condition)
		}
	}

	return conditions
}

// DynamicOperator 动态操作符
type DynamicOperator struct {
	id          string
	name        string
	description string
	schema      map[string]interface{}
}

// Evaluate 评估操作符
func (o *DynamicOperator) Evaluate(left, right interface{}) (bool, error) {
	// 这里应该实现动态操作符的评估逻辑
	// 在实际实现中，可能需要使用脚本引擎或其他机制来执行动态操作
	return false, fmt.Errorf("dynamic operator evaluation not implemented")
}

// GetName 获取操作符名称
func (o *DynamicOperator) GetName() string {
	return o.id
}

// DynamicFunction 动态函数
type DynamicFunction struct {
	id          string
	name        string
	description string
	schema      map[string]interface{}
}

// Execute 执行函数
func (f *DynamicFunction) Execute(args []interface{}) (interface{}, error) {
	// 这里应该实现动态函数的执行逻辑
	// 在实际实现中，可能需要使用脚本引擎或其他机制来执行动态函数
	return nil, fmt.Errorf("dynamic function execution not implemented")
}

// GetName 获取函数名称
func (f *DynamicFunction) GetName() string {
	return f.id
}

// GetArgCount 获取参数数量
func (f *DynamicFunction) GetArgCount() int {
	// 从schema中获取参数数量
	if params, ok := f.schema["parameters"].([]interface{}); ok {
		return len(params)
	}
	return 0
}
