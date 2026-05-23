package repository

import (
	"mailman/internal/models"

	"gorm.io/gorm"
)

// AIPromptTemplateRepository handles database operations for AI prompt templates
type AIPromptTemplateRepository struct {
	db *gorm.DB
}

// NewAIPromptTemplateRepository creates a new AI prompt template repository
func NewAIPromptTemplateRepository(db *gorm.DB) *AIPromptTemplateRepository {
	return &AIPromptTemplateRepository{db: db}
}

// GetByScenario returns an active prompt template by scenario
func (r *AIPromptTemplateRepository) GetByScenario(scenario string) (*models.AIPromptTemplate, error) {
	var template models.AIPromptTemplate
	err := r.db.Where("scenario = ? AND is_active = ?", scenario, true).First(&template).Error
	if err != nil {
		return nil, err
	}
	return &template, nil
}

// GetByID returns a prompt template by ID
func (r *AIPromptTemplateRepository) GetByID(id uint) (*models.AIPromptTemplate, error) {
	var template models.AIPromptTemplate
	err := r.db.First(&template, id).Error
	if err != nil {
		return nil, err
	}
	return &template, nil
}

// List returns all prompt templates
func (r *AIPromptTemplateRepository) List() ([]models.AIPromptTemplate, error) {
	var templates []models.AIPromptTemplate
	err := r.db.Find(&templates).Error
	return templates, err
}

// ListByScenario returns all templates for a specific scenario
func (r *AIPromptTemplateRepository) ListByScenario(scenario string) ([]models.AIPromptTemplate, error) {
	var templates []models.AIPromptTemplate
	err := r.db.Where("scenario = ?", scenario).Find(&templates).Error
	return templates, err
}

// Create creates a new prompt template
func (r *AIPromptTemplateRepository) Create(template *models.AIPromptTemplate) error {
	return r.db.Create(template).Error
}

// Update updates an existing prompt template
func (r *AIPromptTemplateRepository) Update(template *models.AIPromptTemplate) error {
	return r.db.Save(template).Error
}

// Delete deletes a prompt template
func (r *AIPromptTemplateRepository) Delete(id uint) error {
	return r.db.Delete(&models.AIPromptTemplate{}, id).Error
}

// SetActive sets a template as active for its scenario and deactivates others
func (r *AIPromptTemplateRepository) SetActive(id uint) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		// Get the template to find its scenario
		var template models.AIPromptTemplate
		if err := tx.First(&template, id).Error; err != nil {
			return err
		}

		// Deactivate all templates for this scenario
		if err := tx.Model(&models.AIPromptTemplate{}).Where("scenario = ? AND is_active = ?", template.Scenario, true).Update("is_active", false).Error; err != nil {
			return err
		}

		// Activate the specified template
		return tx.Model(&models.AIPromptTemplate{}).Where("id = ?", id).Update("is_active", true).Error
	})
}

// InitializeDefaultTemplates creates default prompt templates if they don't exist
func (r *AIPromptTemplateRepository) InitializeDefaultTemplates() error {
	defaultTemplates := []models.AIPromptTemplate{
		{
			Scenario:    "email_template_generation",
			Name:        "邮件模板生成器",
			Description: "用于生成邮件提取模板的 AI 提示",
			SystemPrompt: `你是一个专业的邮件模板生成助手。你的任务是根据用户的需求，生成用于提取邮件信息的模板配置。

模板配置必须是一个 JSON 数组，每个元素包含以下字段：
- field: 要从中提取的字段（可选值：from, to, cc, subject, body, html_body, headers, ALL）
- type: 提取类型（可选值：regex, js, gotemplate）
- match: （可选）匹配条件，返回 {matched: boolean, reason?: string}
- extract: 提取规则，返回提取的字符串或 null

示例配置：
[
  {
    "field": "subject",
    "type": "regex",
    "extract": "订单号[：:]\\s*([A-Z0-9]+)"
  },
  {
    "field": "body",
    "type": "regex",
    "match": "发货通知",
    "extract": "快递单号[：:]\\s*([A-Z0-9]+)"
  }
]

请根据用户的描述，生成合适的提取模板配置。确保返回的是有效的 JSON 数组格式。`,
			UserPrompt:  "",
			Variables:   models.JSONMap{"user_input": "用户输入的需求描述"},
			MaxTokens:   1500,
			Temperature: 0.7,
			IsActive:    true,
		},
		{
			Scenario:    "trigger_name_description",
			Name:        "触发器名称描述生成",
			Description: "根据触发器配置自动生成名称和描述信息",
			SystemPrompt: `你是一个专业的邮件自动化助手。你需要根据提供的触发器配置信息，生成一个简洁明了的名称和描述。

分析触发器配置时，请关注以下要点：
1. 过滤条件（expressions）：包含了邮件匹配规则，如发件人、收件人、主题等
2. 动作列表（actions）：触发器匹配后要执行的操作，如转发、通知等
3. 整体功能：综合分析这个触发器的用途

生成规则：
- 名称：简洁的中文名称，不超过20个字符，能够清晰表达触发器的核心用途
- 描述：详细的中文描述（50-100字），说明这个触发器的作用、触发条件和执行动作

请以JSON格式返回：
{"name": "触发器名称", "description": "触发器描述"}`,
			UserPrompt:  "",
			Variables:   models.JSONMap{"expressions": "过滤条件配置", "actions": "动作列表配置"},
			MaxTokens:   500,
			Temperature: 0.7,
			IsActive:    true,
		},
		{
			Scenario:    "filter_name_description",
			Name:        "过滤器名称描述生成",
			Description: "根据过滤条件自动生成名称和描述信息",
			SystemPrompt: `你是一个专业的邮件自动化助手。你需要根据提供的过滤条件配置，生成一个简洁明了的名称和描述。

过滤条件配置说明：
- 条件组（type: group）：包含多个子条件，通过 AND/OR 逻辑连接
- 插件条件（type: plugin）：使用特定的过滤插件，如：
  - email.from: 发件人过滤
  - email.to: 收件人过滤
  - email.subject: 主题过滤
  - email.body: 正文过滤
  - email.has_attachment: 附件过滤
- 表达式条件（type: expression）：JavaScript 表达式

分析时请关注：
1. 过滤的目标字段（发件人、收件人、主题等）
2. 匹配模式（包含、等于、正则等）
3. 匹配内容（具体的筛选值）

生成规则：
- 名称：简洁的中文名称，不超过15个字符，能够清晰表达过滤条件
- 描述：简短的中文描述（30-50字），说明这个过滤器匹配什么样的邮件

请以JSON格式返回：
{"name": "过滤器名称", "description": "过滤器描述"}`,
			UserPrompt:  "",
			Variables:   models.JSONMap{"conditions": "过滤条件配置"},
			MaxTokens:   300,
			Temperature: 0.7,
			IsActive:    true,
		},
		{
			Scenario:    "action_name_description",
			Name:        "动作名称描述生成",
			Description: "根据动作配置自动生成名称和描述信息",
			SystemPrompt: `你是一个专业的邮件自动化助手。你需要根据提供的动作配置信息，生成一个简洁明了的名称和描述。

常见的动作插件类型：
- email_forward_action: 邮件转发，参数包括收件人、是否包含原文等
- email_transform_action: 邮件内容转换，参数包括目标字段、转换类型、模板等
- telegram_bot_action: Telegram 通知，参数包括 Bot Token、Chat ID、消息内容等
- webhook_action: Webhook 调用，参数包括 URL、请求方法、请求体等
- email_label_action: 邮件标签管理
- email_delete_action: 邮件删除

分析时请关注：
1. 插件类型（pluginId）：决定了动作的主要功能
2. 配置参数（config）：具体的执行参数
3. 动作别名（alias）：如果有的话

生成规则：
- 名称：简洁的中文名称，不超过15个字符，能够清晰表达动作的作用
- 描述：简短的中文描述（30-50字），说明这个动作会执行什么操作

请以JSON格式返回：
{"name": "动作名称", "description": "动作描述"}`,
			UserPrompt:  "",
			Variables:   models.JSONMap{"pluginId": "插件类型", "pluginName": "插件名称", "config": "配置参数"},
			MaxTokens:   300,
			Temperature: 0.7,
			IsActive:    true,
		},
	}

	for _, template := range defaultTemplates {
		// Check if template already exists
		var existing models.AIPromptTemplate
		err := r.db.Where("scenario = ?", template.Scenario).First(&existing).Error
		if err == gorm.ErrRecordNotFound {
			// Create the template
			if err := r.db.Create(&template).Error; err != nil {
				return err
			}
		}
	}

	return nil
}
