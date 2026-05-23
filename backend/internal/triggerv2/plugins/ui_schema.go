package plugins

// UIFieldType UI字段类型
type UIFieldType string

const (
	UIFieldTypeText        UIFieldType = "text"         // 文本输入
	UIFieldTypeNumber      UIFieldType = "number"       // 数字输入
	UIFieldTypeSelect      UIFieldType = "select"       // 下拉选择
	UIFieldTypeMultiSelect UIFieldType = "multi_select" // 多选
	UIFieldTypeDate        UIFieldType = "date"         // 日期选择
	UIFieldTypeTime        UIFieldType = "time"         // 时间选择
	UIFieldTypeBoolean     UIFieldType = "boolean"      // 布尔开关
	UIFieldTypeJSON        UIFieldType = "json"         // JSON编辑器
	UIFieldTypeCode        UIFieldType = "code"         // 代码编辑器
	UIFieldTypeFile        UIFieldType = "file"         // 文件选择
	UIFieldTypeDynamic     UIFieldType = "dynamic"      // 动态选择（需要回调）
	UIFieldTypeJavaScript  UIFieldType = "javascript"   // JavaScript代码编辑器
	UIFieldTypeGoTemplate  UIFieldType = "gotemplate"   // Go模板编辑器
	UIFieldTypeRegex       UIFieldType = "regex"        // 正则表达式编辑器
	UIFieldTypeKeyValue    UIFieldType = "key_value"    // 键值对输入（用于HTTP头等）
	UIFieldTypeArray       UIFieldType = "array"        // 数组类型（可添加/删除/排序项）
)

// UIField UI字段定义
type UIField struct {
	// 基本信息
	Name        string      `json:"name"`        // 字段名称
	Label       string      `json:"label"`       // 显示标签
	Type        UIFieldType `json:"type"`        // 字段类型
	Description string      `json:"description"` // 字段描述
	Placeholder string      `json:"placeholder"` // 占位符文本
	Tooltip     string      `json:"tooltip"`     // 详细帮助信息，用于鼠标悬停时显示
	HelpUrl     string      `json:"help_url"`    // 帮助文档链接

	// 验证规则
	Required   bool          `json:"required"`   // 是否必填
	Pattern    string        `json:"pattern"`    // 正则表达式
	Min        interface{}   `json:"min"`        // 最小值
	Max        interface{}   `json:"max"`        // 最大值
	Enum       []interface{} `json:"enum"`       // 枚举值
	Validation *UIValidation `json:"validation"` // 验证规则（用于更复杂的验证）

	// UI配置
	Width        string      `json:"width"`    // 宽度（如 "full", "half", "1/3"）
	Hidden       bool        `json:"hidden"`   // 是否隐藏
	Disabled     bool        `json:"disabled"` // 是否禁用
	DefaultValue interface{} `json:"default"`  // 默认值

	// 动态选项（用于select类型）
	Options    []UIOption `json:"options"`     // 静态选项
	OptionsAPI string     `json:"options_api"` // 动态选项API

	// 依赖关系
	DependsOn []string               `json:"depends_on"` // 依赖的其他字段
	ShowIf    map[string]interface{} `json:"show_if"`    // 显示条件

	// 数组类型专用：子项架构
	ItemSchema *UISchema `json:"item_schema,omitempty"` // 数组项的架构（用于 array 类型）

	// 代码编辑器专用：自定义示例和文档
	Examples      []CodeExample          `json:"examples,omitempty"`      // 代码示例
	Documentation []DocumentationSection `json:"documentation,omitempty"` // 文档说明
}

// UIValidation 验证规则
type UIValidation struct {
	Pattern   string `json:"pattern"`    // 正则表达式模式
	Message   string `json:"message"`    // 验证失败时的错误消息
	MinLength int    `json:"min_length"` // 最小长度
	MaxLength int    `json:"max_length"` // 最大长度
}

// CodeExample 代码示例
type CodeExample struct {
	Title       string `json:"title"`       // 示例标题
	Description string `json:"description"` // 示例描述
	Code        string `json:"code"`        // 示例代码
}

// DocumentationSection 文档部分
type DocumentationSection struct {
	Title    string           `json:"title"`              // 文档标题
	Content  string           `json:"content"`            // 文档内容
	Examples []DocExampleItem `json:"examples,omitempty"` // 文档示例
}

// DocExampleItem 文档示例项
type DocExampleItem struct {
	Code        string `json:"code"`        // 示例代码
	Description string `json:"description"` // 示例描述
}

// UIOption UI选项
type UIOption struct {
	Value       interface{} `json:"value"`       // 选项值
	Label       string      `json:"label"`       // 显示标签
	Description string      `json:"description"` // 选项描述
	Icon        string      `json:"icon"`        // 图标
	Color       string      `json:"color"`       // 颜色
}

// UIOperator UI操作符定义
type UIOperator struct {
	Value        string   `json:"value"`         // 操作符值
	Label        string   `json:"label"`         // 显示标签
	Description  string   `json:"description"`   // 操作符描述
	ApplicableTo []string `json:"applicable_to"` // 适用的字段类型
}

// UISchema UI架构定义
type UISchema struct {
	// 条件配置
	Fields    []UIField    `json:"fields"`    // 字段定义
	Operators []UIOperator `json:"operators"` // 支持的操作符

	// 布局配置
	Layout  string `json:"layout"`  // 布局方式（"horizontal", "vertical", "grid"）
	Columns int    `json:"columns"` // 列数（用于grid布局）

	// 交互配置
	AllowCustomFields bool `json:"allow_custom_fields"` // 是否允许自定义字段
	AllowNesting      bool `json:"allow_nesting"`       // 是否允许嵌套条件
	MaxNestingLevel   int  `json:"max_nesting_level"`   // 最大嵌套层级

	// 帮助信息
	HelpText string      `json:"help_text"` // 帮助文本
	Examples []UIExample `json:"examples"`  // 示例
}

// UIExample UI示例
type UIExample struct {
	Title       string                 `json:"title"`       // 示例标题
	Description string                 `json:"description"` // 示例描述
	Expression  map[string]interface{} `json:"expression"`  // 表达式内容
}

// ConditionPluginWithUI 带UI的条件插件接口
type ConditionPluginWithUI interface {
	ConditionPlugin

	// 获取UI架构
	GetUISchema() *UISchema

	// 动态数据获取
	GetDynamicOptions(field string, query string) ([]UIOption, error)

	// 字段值验证
	ValidateFieldValue(field string, value interface{}) error

	// 获取字段建议
	GetFieldSuggestions(field string, prefix string) ([]string, error)
}

// ActionPluginWithUI 带UI的动作插件接口
type ActionPluginWithUI interface {
	ActionPlugin

	// 获取UI架构
	GetUISchema() *UISchema

	// 动态数据获取
	GetDynamicOptions(field string, query string) ([]UIOption, error)

	// 字段值验证
	ValidateFieldValue(field string, value interface{}) error

	// 获取字段建议
	GetFieldSuggestions(field string, prefix string) ([]string, error)
}

// UICallback UI回调接口
type UICallback interface {
	// 获取邮箱地址列表
	GetEmailAddresses(query string) ([]string, error)

	// 获取用户列表
	GetUsers(query string) ([]UIOption, error)

	// 获取标签列表
	GetTags(query string) ([]string, error)

	// 获取自定义数据
	GetCustomData(dataType string, query string) ([]UIOption, error)
}

// ExpressionUIProvider 表达式UI提供者
type ExpressionUIProvider interface {
	// 获取所有可用的条件插件UI架构
	GetAvailableConditions() (map[string]*UISchema, error)

	// 获取内置条件的UI架构
	GetBuiltinConditions() *UISchema

	// 合并多个UI架构
	MergeSchemas(schemas ...*UISchema) *UISchema

	// 执行UI回调
	ExecuteCallback(pluginID string, callback string, params map[string]interface{}) (interface{}, error)
}
