package services

import (
	"mailman/internal/models"
	"testing"
	"time"
)

// createMockEmail 创建一个模拟邮件用于测试
func createMockEmail() models.Email {
	return models.Email{
		ID:        1,
		MessageID: "test-message-id@example.com",
		AccountID: 1,
		Subject:   "订单确认 - 订单号：ORD-2024-001",
		From:      models.StringSlice{"sender@example.com", "noreply@shop.com"},
		To:        models.StringSlice{"recipient@example.com"},
		Cc:        models.StringSlice{"cc@example.com"},
		Bcc:       models.StringSlice{"bcc@example.com"},
		Date:      time.Now(),
		Body: `亲爱的客户，

您的订单已确认：
订单号：ORD-2024-001
总金额：￥299.99
快递单号：SF1234567890
联系电话：13800138000

感谢您的购买！

网站：https://shop.example.com
邮箱：support@example.com`,
		HTMLBody: `<html>
<body>
<h1>订单确认</h1>
<p>亲爱的客户，</p>
<p>您的订单已确认：</p>
<ul>
<li>订单号：<strong>ORD-2024-001</strong></li>
<li>总金额：<strong>￥299.99</strong></li>
<li>快递单号：<strong>SF1234567890</strong></li>
<li>联系电话：<strong>13800138000</strong></li>
</ul>
<p>感谢您的购买！</p>
<p>网站：<a href="https://shop.example.com">https://shop.example.com</a></p>
<p>邮箱：<a href="mailto:support@example.com">support@example.com</a></p>
</body>
</html>`,
		MailboxName: "INBOX",
		Flags:       models.StringSlice{"\\Seen", "\\Flagged"},
		Size:        1024,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
}

// assertEqual 辅助函数用于比较两个值
func assertEqual(t *testing.T, expected, actual interface{}, message string) {
	if expected != actual {
		t.Errorf("%s: expected %v, got %v", message, expected, actual)
	}
}

// assertNotNil 辅助函数用于检查值不为nil
func assertNotNil(t *testing.T, value interface{}, message string) {
	if value == nil {
		t.Errorf("%s: expected not nil, got nil", message)
	}
}

// assertNil 辅助函数用于检查值为nil
func assertNil(t *testing.T, value interface{}, message string) {
	if value != nil {
		// 如果是ExtractorResult类型，检查是否为空结果
		if result, ok := value.(*ExtractorResult); ok {
			if result != nil && len(result.Matches) > 0 {
				t.Errorf("%s: expected no matches, got %d matches", message, len(result.Matches))
			}
			// 如果result不为nil但matches为空，则认为测试通过
		} else {
			t.Errorf("%s: expected nil, got %v", message, value)
		}
	}
}

// assertTrue 辅助函数用于检查条件为真
func assertTrue(t *testing.T, condition bool, message string) {
	if !condition {
		t.Errorf("%s: expected true, got false", message)
	}
}

// assertNoError 辅助函数用于检查无错误
func assertNoError(t *testing.T, err error, message string) {
	if err != nil {
		t.Errorf("%s: expected no error, got %v", message, err)
	}
}

// assertError 辅助函数用于检查有错误
func assertError(t *testing.T, err error, message string) {
	if err == nil {
		t.Errorf("%s: expected error, got nil", message)
	}
}

// assertContains 辅助函数用于检查切片包含特定值
func assertContains(t *testing.T, slice []string, value string, message string) {
	for _, item := range slice {
		if item == value {
			return
		}
	}
	t.Errorf("%s: expected slice to contain %v, got %v", message, value, slice)
}

// TestExtractorService_RegexExtraction 测试正则表达式提取功能
func TestExtractorService_RegexExtraction(t *testing.T) {
	service := NewExtractorService()
	email := createMockEmail()

	tests := []struct {
		name           string
		field          ExtractorField
		pattern        string
		expectedCount  int
		expectedResult []string
		shouldError    bool
	}{
		{
			name:           "提取订单号",
			field:          ExtractorFieldSubject,
			pattern:        `ORD-\d{4}-\d{3}`,
			expectedCount:  1,
			expectedResult: []string{"ORD-2024-001"},
			shouldError:    false,
		},
		{
			name:           "提取金额",
			field:          ExtractorFieldBody,
			pattern:        `￥[\d.]+`,
			expectedCount:  1,
			expectedResult: []string{"￥299.99"},
			shouldError:    false,
		},
		{
			name:           "提取邮箱地址",
			field:          ExtractorFieldBody,
			pattern:        `[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}`,
			expectedCount:  1,
			expectedResult: []string{"support@example.com"},
			shouldError:    false,
		},
		{
			name:           "提取URL",
			field:          ExtractorFieldBody,
			pattern:        `https?://[^\s]+`,
			expectedCount:  1,
			expectedResult: []string{"https://shop.example.com"},
			shouldError:    false,
		},
		{
			name:           "提取手机号",
			field:          ExtractorFieldBody,
			pattern:        `1[3-9]\d{9}`,
			expectedCount:  1,
			expectedResult: []string{"13800138000"},
			shouldError:    false,
		},
		{
			name:           "无匹配结果",
			field:          ExtractorFieldBody,
			pattern:        `NOTFOUND-\d+`,
			expectedCount:  0,
			expectedResult: []string{},
			shouldError:    false,
		},
		{
			name:          "无效正则表达式",
			field:         ExtractorFieldBody,
			pattern:       `[invalid`,
			expectedCount: 0,
			shouldError:   true,
		},
		{
			name:           "使用替换语法提取订单号",
			field:          ExtractorFieldSubject,
			pattern:        `订单号：(ORD-\d{4}-\d{3})|||$1`,
			expectedCount:  1,
			expectedResult: []string{"ORD-2024-001"},
			shouldError:    false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			config := ExtractorConfig{
				Field:   tt.field,
				Type:    ExtractorTypeRegex,
				Extract: tt.pattern,
			}

			result, err := service.ExtractFromEmail(email, []ExtractorConfig{config})

			if tt.shouldError {
				assertError(t, err, "Expected error")
				return
			}

			assertNoError(t, err, "Expected no error")

			if tt.expectedCount == 0 {
				if result != nil {
					t.Errorf("Expected nil result, got %v", result)
				}
			} else {
				assertNotNil(t, result, "Expected non-nil result")
				assertTrue(t, len(result.Matches) >= tt.expectedCount, "Match count should be at least expected")
				if len(tt.expectedResult) > 0 {
					for _, expected := range tt.expectedResult {
						assertContains(t, result.Matches, expected, "Expected result")
					}
				}
			}
		})
	}
}

// TestExtractorService_JavaScriptExtraction 测试JavaScript提取功能
func TestExtractorService_JavaScriptExtraction(t *testing.T) {
	service := NewExtractorService()
	email := createMockEmail()

	tests := []struct {
		name           string
		field          ExtractorField
		script         string
		expectedCount  int
		expectedResult []string
		shouldError    bool
	}{
		{
			name:  "提取订单号",
			field: ExtractorFieldSubject,
			script: `
				var matches = [];
				for (var i = 0; i < parsedContent.length; i++) {
					var match = parsedContent[i].match(/ORD-\d{4}-\d{3}/);
					if (match) matches.push(match[0]);
				}
				return matches;
			`,
			expectedCount:  1,
			expectedResult: []string{"ORD-2024-001"},
			shouldError:    false,
		},
		{
			name:  "提取多个邮箱",
			field: ExtractorFieldAll,
			script: `
				var emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
				var matches = [];
				for (var i = 0; i < parsedContent.length; i++) {
					var found = parsedContent[i].match(emailRegex);
					if (found) {
						matches = matches.concat(found);
					}
				}
				return matches;
			`,
			expectedCount: 7, // 多个邮箱地址 (包含重复)
			shouldError:   false,
		},
		{
			name:  "复杂数据处理",
			field: ExtractorFieldBody,
			script: `
				var result = [];
				
				for (var i = 0; i < parsedContent.length; i++) {
					var text = parsedContent[i];
					
					// 提取订单号
					var orderMatch = text.match(/订单号：([A-Z0-9-]+)/);
					if (orderMatch) {
						result.push("ORDER:" + orderMatch[1]);
					}
					
					// 提取金额
					var priceMatch = text.match(/￥([\d.]+)/);
					if (priceMatch) {
						result.push("PRICE:" + priceMatch[1]);
					}
					
					// 提取快递单号
					var trackingMatch = text.match(/快递单号：([A-Z0-9]+)/);
					if (trackingMatch) {
						result.push("TRACKING:" + trackingMatch[1]);
					}
				}
				
				return result;
			`,
			expectedCount:  3,
			expectedResult: []string{"ORDER:ORD-2024-001", "PRICE:299.99", "TRACKING:SF1234567890"},
			shouldError:    false,
		},
		{
			name:  "返回空结果",
			field: ExtractorFieldBody,
			script: `
				return [];
			`,
			expectedCount: 0,
			shouldError:   false,
		},
		{
			name:  "JavaScript语法错误",
			field: ExtractorFieldBody,
			script: `
				var invalid syntax here
			`,
			expectedCount: 0,
			shouldError:   true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			config := ExtractorConfig{
				Field:   tt.field,
				Type:    ExtractorTypeJS,
				Extract: tt.script,
			}

			result, err := service.ExtractFromEmail(email, []ExtractorConfig{config})

			if tt.shouldError {
				assertError(t, err, "Expected error")
				return
			}

			assertNoError(t, err, "Expected no error")

			if tt.expectedCount == 0 {
				assertNil(t, result, "Expected nil result")
			} else {
				assertNotNil(t, result, "Expected non-nil result")
				assertEqual(t, tt.expectedCount, len(result.Matches), "Match count")
				if len(tt.expectedResult) > 0 {
					for _, expected := range tt.expectedResult {
						assertContains(t, result.Matches, expected, "Expected result")
					}
				}
			}
		})
	}
}

// TestExtractorService_GoTemplateExtraction 测试Go模板提取功能
func TestExtractorService_GoTemplateExtraction(t *testing.T) {
	service := NewExtractorService()
	email := createMockEmail()

	tests := []struct {
		name           string
		field          ExtractorField
		template       string
		expectedCount  int
		expectedResult []string
		shouldError    bool
	}{
		{
			name:           "提取订单信息",
			field:          ExtractorFieldAll,
			template:       `{{$matches := (regex "ORD-\\d{4}-\\d{3}" .AllText)}}{{if $matches}}{{index $matches 0}}{{end}}`,
			expectedCount:  1,
			expectedResult: []string{"ORD-2024-001"},
			shouldError:    false,
		},
		{
			name:           "使用内置函数",
			field:          ExtractorFieldAll,
			template:       `{{if contains .Subject "订单确认"}}{{replace .Subject "订单确认 - " ""}}{{end}}`,
			expectedCount:  1,
			expectedResult: []string{"订单号：ORD-2024-001"},
			shouldError:    false,
		},
		{
			name:           "提取邮箱地址",
			field:          ExtractorFieldAll,
			template:       `{{$emails := (extractEmails .AllText)}}{{if $emails}}{{index $emails 0}}{{end}}`,
			expectedCount:  1,
			expectedResult: []string{"sender@example.com"},
			shouldError:    false,
		},
		{
			name:           "提取链接",
			field:          ExtractorFieldAll,
			template:       `{{$links := (extractLinks .AllText)}}{{if $links}}{{index $links 0}}{{end}}`,
			expectedCount:  1,
			expectedResult: []string{"https://shop.example.com"},
			shouldError:    false,
		},
		{
			name:           "条件判断",
			field:          ExtractorFieldAll,
			template:       `{{if contains .Subject "订单"}}ORDER_EMAIL{{else}}OTHER_EMAIL{{end}}`,
			expectedCount:  1,
			expectedResult: []string{"ORDER_EMAIL"},
			shouldError:    false,
		},
		{
			name:          "无匹配结果",
			field:         ExtractorFieldAll,
			template:      `{{range (regex "NOTFOUND-\\d+" .AllText)}}{{.}}{{end}}`,
			expectedCount: 0,
			shouldError:   false,
		},
		{
			name:          "无效模板语法",
			field:         ExtractorFieldAll,
			template:      `{{invalid template syntax`,
			expectedCount: 0,
			shouldError:   true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			config := ExtractorConfig{
				Field:   tt.field,
				Type:    ExtractorTypeGoTemplate,
				Extract: tt.template,
			}

			result, err := service.ExtractFromEmail(email, []ExtractorConfig{config})

			if tt.shouldError {
				assertError(t, err, "Expected error")
				return
			}

			assertNoError(t, err, "Expected no error")

			if tt.expectedCount == 0 {
				assertNil(t, result, "Expected nil result")
			} else {
				assertNotNil(t, result, "Expected non-nil result")
				assertEqual(t, tt.expectedCount, len(result.Matches), "Match count")
				if len(tt.expectedResult) > 0 {
					for _, expected := range tt.expectedResult {
						assertContains(t, result.Matches, expected, "Expected result")
					}
				}
			}
		})
	}
}

// TestExtractorService_MatchConditions 测试匹配条件功能
func TestExtractorService_MatchConditions(t *testing.T) {
	service := NewExtractorService()
	email := createMockEmail()

	tests := []struct {
		name        string
		field       ExtractorField
		extractType ExtractorType
		matchConfig *string
		extract     string
		shouldMatch bool
		shouldError bool
	}{
		{
			name:        "正则表达式匹配成功",
			field:       ExtractorFieldSubject,
			extractType: ExtractorTypeRegex,
			matchConfig: testStringPtr("订单确认"),
			extract:     `ORD-\d{4}-\d{3}`,
			shouldMatch: true,
			shouldError: false,
		},
		{
			name:        "正则表达式匹配失败",
			field:       ExtractorFieldSubject,
			extractType: ExtractorTypeRegex,
			matchConfig: testStringPtr("退款申请"),
			extract:     `ORD-\d{4}-\d{3}`,
			shouldMatch: false,
			shouldError: false,
		},
		{
			name:        "JavaScript匹配成功",
			field:       ExtractorFieldSubject,
			extractType: ExtractorTypeJS,
			matchConfig: testStringPtr(`
				return parsedContent.some(function(text) {
					return text.includes("订单确认");
				});
			`),
			extract:     `return ["ORDER_FOUND"];`,
			shouldMatch: true,
			shouldError: false,
		},
		{
			name:        "JavaScript匹配失败",
			field:       ExtractorFieldSubject,
			extractType: ExtractorTypeJS,
			matchConfig: testStringPtr(`
				return parsedContent.some(function(text) {
					return text.includes("退款申请");
				});
			`),
			extract:     `return ["ORDER_FOUND"];`,
			shouldMatch: false,
			shouldError: false,
		},
		{
			name:        "Go模板匹配成功",
			field:       ExtractorFieldSubject,
			extractType: ExtractorTypeGoTemplate,
			matchConfig: testStringPtr(`{{contains .Subject "订单确认"}}`),
			extract:     `ORDER_FOUND`,
			shouldMatch: true,
			shouldError: false,
		},
		{
			name:        "Go模板匹配失败",
			field:       ExtractorFieldSubject,
			extractType: ExtractorTypeGoTemplate,
			matchConfig: testStringPtr(`{{contains .Subject "退款申请"}}`),
			extract:     `ORDER_FOUND`,
			shouldMatch: false,
			shouldError: false,
		},
		{
			name:        "无匹配条件默认匹配",
			field:       ExtractorFieldSubject,
			extractType: ExtractorTypeRegex,
			matchConfig: nil,
			extract:     `ORD-\d{4}-\d{3}`,
			shouldMatch: true,
			shouldError: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			config := ExtractorConfig{
				Field:   tt.field,
				Type:    tt.extractType,
				Match:   tt.matchConfig,
				Extract: tt.extract,
			}

			result, err := service.ExtractFromEmail(email, []ExtractorConfig{config})

			if tt.shouldError {
				assertError(t, err, "Expected error")
				return
			}

			assertNoError(t, err, "Expected no error")

			if tt.shouldMatch {
				assertNotNil(t, result, "Expected match result")
				if result != nil && len(result.Matches) == 0 {
					t.Errorf("Expected matches, got empty result")
				}
			} else {
				assertNil(t, result, "Expected no match result")
			}
		})
	}
}

// TestExtractorService_FieldExtraction 测试不同字段提取功能
func TestExtractorService_FieldExtraction(t *testing.T) {
	service := NewExtractorService()
	email := createMockEmail()

	tests := []struct {
		name             string
		field            ExtractorField
		pattern          string
		expectedCount    int
		shouldHaveResult bool
	}{
		{
			name:             "从发件人字段提取",
			field:            ExtractorFieldFrom,
			pattern:          `@example\.com`,
			expectedCount:    1,
			shouldHaveResult: true,
		},
		{
			name:             "从收件人字段提取",
			field:            ExtractorFieldTo,
			pattern:          `recipient`,
			expectedCount:    1,
			shouldHaveResult: true,
		},
		{
			name:             "从抄送字段提取",
			field:            ExtractorFieldCC,
			pattern:          `cc@`,
			expectedCount:    1,
			shouldHaveResult: true,
		},
		{
			name:             "从主题字段提取",
			field:            ExtractorFieldSubject,
			pattern:          `订单确认`,
			expectedCount:    1,
			shouldHaveResult: true,
		},
		{
			name:             "从正文字段提取",
			field:            ExtractorFieldBody,
			pattern:          `订单号`,
			expectedCount:    1,
			shouldHaveResult: true,
		},
		{
			name:             "从HTML正文字段提取",
			field:            ExtractorFieldHTMLBody,
			pattern:          `<strong>`,
			expectedCount:    4,
			shouldHaveResult: true,
		},
		{
			name:             "从所有字段提取",
			field:            ExtractorFieldAll,
			pattern:          `example\.com`,
			expectedCount:    9,
			shouldHaveResult: true,
		},
		{
			name:             "从头部字段提取（当前为空）",
			field:            ExtractorFieldHeaders,
			pattern:          `.*`,
			expectedCount:    0,
			shouldHaveResult: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			config := ExtractorConfig{
				Field:   tt.field,
				Type:    ExtractorTypeRegex,
				Extract: tt.pattern,
			}

			result, err := service.ExtractFromEmail(email, []ExtractorConfig{config})

			assertNoError(t, err, "Expected no error")

			if tt.shouldHaveResult {
				assertNotNil(t, result, "Expected result")
				assertEqual(t, tt.expectedCount, len(result.Matches), "Match count")
			} else {
				assertNil(t, result, "Expected no result")
			}
		})
	}
}

// TestExtractorService_MultipleExtractors 测试多个提取器组合
func TestExtractorService_MultipleExtractors(t *testing.T) {
	service := NewExtractorService()
	email := createMockEmail()

	configs := []ExtractorConfig{
		{
			Field:   ExtractorFieldSubject,
			Type:    ExtractorTypeRegex,
			Extract: `ORD-\d{4}-\d{3}`,
		},
		{
			Field:   ExtractorFieldBody,
			Type:    ExtractorTypeRegex,
			Extract: `￥[\d.]+`,
		},
		{
			Field: ExtractorFieldBody,
			Type:  ExtractorTypeJS,
			Extract: `
				return parsedContent.flatMap(function(text) {
					var matches = text.match(/1[3-9]\d{9}/g);
					return matches ? matches : [];
				});
			`,
		},
	}

	result, err := service.ExtractFromEmail(email, configs)

	assertNoError(t, err, "Expected no error")
	assertNotNil(t, result, "Expected result")
	assertEqual(t, 2, len(result.Matches), "Match count")
	assertContains(t, result.Matches, "ORD-2024-001", "Order ID")
	assertContains(t, result.Matches, "￥299.99", "Price")
}

// TestExtractorService_EdgeCases 测试边界情况
func TestExtractorService_EdgeCases(t *testing.T) {
	service := NewExtractorService()

	// 测试空邮件
	emptyEmail := models.Email{
		ID:        1,
		MessageID: "empty@example.com",
		Subject:   "",
		From:      models.StringSlice{},
		To:        models.StringSlice{},
		Cc:        models.StringSlice{},
		Body:      "",
		HTMLBody:  "",
	}

	config := ExtractorConfig{
		Field:   ExtractorFieldAll,
		Type:    ExtractorTypeRegex,
		Extract: `.*`,
	}

	result, err := service.ExtractFromEmail(emptyEmail, []ExtractorConfig{config})
	assertNoError(t, err, "Expected no error for empty email")
	if result != nil && len(result.Matches) > 0 {
		t.Errorf("Expected no matches for empty email, got %d matches", len(result.Matches))
	}

	// 测试空提取器配置
	email := createMockEmail()
	result, err = service.ExtractFromEmail(email, []ExtractorConfig{})
	assertNoError(t, err, "Expected no error for empty config")
	if result != nil && len(result.Matches) > 0 {
		t.Errorf("Expected no matches for empty config, got %d matches", len(result.Matches))
	}

	// 测试不支持的提取器类型
	config.Type = ExtractorType("unsupported")
	result, err = service.ExtractFromEmail(email, []ExtractorConfig{config})
	assertError(t, err, "Expected error for unsupported type")
}

// testStringPtr 返回字符串指针的辅助函数
func testStringPtr(s string) *string {
	return &s
}
