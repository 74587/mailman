package services

import (
	"crypto/sha256"
	"fmt"
	"log"
	"math/rand"
	"sort"
	"strings"
	"time"

	"mailman/internal/models"
)

// matchesAlias 检查邮件是否匹配别名地址
func (m *SubscriptionManager) matchesAlias(email models.Email, aliasAddress string) bool {
	log.Printf("[SubscriptionManager] DEBUG: matchesAlias - checking alias '%s' against email To=%v, Cc=%v", aliasAddress, email.To, email.Cc)

	// 处理 Gmail 别名 (user+alias@gmail.com)
	if strings.Contains(aliasAddress, "+") && strings.Contains(aliasAddress, "@gmail.com") {
		log.Printf("[SubscriptionManager] DEBUG: Checking Gmail alias pattern")
		// 检查邮件的收件人列表中是否包含该别名
		for _, to := range email.To {
			if strings.EqualFold(to, aliasAddress) {
				log.Printf("[SubscriptionManager] DEBUG: Gmail alias matched in To field: %s", to)
				return true
			}
		}
		// 也检查 CC 和 BCC
		for _, cc := range email.Cc {
			if strings.EqualFold(cc, aliasAddress) {
				log.Printf("[SubscriptionManager] DEBUG: Gmail alias matched in Cc field: %s", cc)
				return true
			}
		}
	}

	// 处理域名邮箱 (*@domain.com)
	if strings.HasPrefix(aliasAddress, "*@") {
		log.Printf("[SubscriptionManager] DEBUG: Checking domain wildcard pattern")
		domain := strings.TrimPrefix(aliasAddress, "*")
		for _, to := range email.To {
			if strings.HasSuffix(strings.ToLower(to), strings.ToLower(domain)) {
				log.Printf("[SubscriptionManager] DEBUG: Domain wildcard matched in To field: %s matches %s", to, domain)
				return true
			}
		}
		for _, cc := range email.Cc {
			if strings.HasSuffix(strings.ToLower(cc), strings.ToLower(domain)) {
				log.Printf("[SubscriptionManager] DEBUG: Domain wildcard matched in Cc field: %s matches %s", cc, domain)
				return true
			}
		}
	}

	// 精确匹配
	log.Printf("[SubscriptionManager] DEBUG: Checking exact match")
	for _, to := range email.To {
		extractedEmail := extractEmail(to)
		log.Printf("[SubscriptionManager] DEBUG: Comparing extracted email '%s' with alias '%s'", extractedEmail, aliasAddress)
		if strings.EqualFold(extractedEmail, aliasAddress) {
			log.Printf("[SubscriptionManager] DEBUG: Exact match found: %s", extractedEmail)
			return true
		}
	}

	log.Printf("[SubscriptionManager] DEBUG: No alias match found for '%s'", aliasAddress)
	return false
}

// matchesAddress 检查地址列表是否包含指定地址
func (m *SubscriptionManager) matchesAddress(addresses models.StringSlice, targetAddress string) bool {
	targetEmail := strings.ToLower(extractEmail(targetAddress))

	for _, addr := range addresses {
		if strings.Contains(strings.ToLower(addr), targetEmail) {
			return true
		}
	}
	return false
}

// extractEmail 从 "Name <email@domain.com>" 格式中提取邮箱地址
func extractEmail(address string) string {
	if start := strings.Index(address, "<"); start != -1 {
		if end := strings.Index(address, ">"); end != -1 && end > start {
			return address[start+1 : end]
		}
	}
	return strings.TrimSpace(address)
}

// containsIgnoreCase 不区分大小写的字符串包含检查
func containsIgnoreCase(s, substr string) bool {
	return strings.Contains(strings.ToLower(s), strings.ToLower(substr))
}

// contains 检查字符串切片是否包含指定字符串
func contains(slice []string, item string) bool {
	for _, s := range slice {
		if s == item {
			return true
		}
	}
	return false
}

// generateSubscriptionID 生成订阅ID
func generateSubscriptionID() string {
	// 使用时间戳和随机数生成ID，避免外部依赖
	return fmt.Sprintf("sub_%d_%d", time.Now().UnixNano(), rand.Int63())
}

// resolveRealMailbox 解析真实邮箱地址
func (m *SubscriptionManager) resolveRealMailbox(emailAddress string) string {
	// 处理 Gmail 别名
	if strings.Contains(emailAddress, "@gmail.com") && strings.Contains(emailAddress, "+") {
		parts := strings.Split(emailAddress, "+")
		if len(parts) > 1 {
			userPart := parts[0]
			domainPart := strings.Split(parts[1], "@")[1]
			return userPart + "@" + domainPart
		}
	}

	// 处理域名邮箱
	if strings.HasPrefix(emailAddress, "*@") {
		// 这里需要从数据库查找该域名对应的真实邮箱
		// 暂时返回原始地址
		return emailAddress
	}

	// 默认返回原始地址
	return emailAddress
}

// generateSubscriptionFingerprint 生成订阅指纹用于去重
func (m *SubscriptionManager) generateSubscriptionFingerprint(req SubscribeRequest) string {
	// 构建指纹字符串，包含关键的去重字段
	var parts []string

	// 订阅类型
	parts = append(parts, string(req.Type))

	// 触发器 ID（确保每个触发器有独立订阅）
	if req.Metadata != nil {
		if triggerID, ok := req.Metadata["triggerID"]; ok {
			parts = append(parts, fmt.Sprintf("trigger:%v", triggerID))
		}
		if triggerName, ok := req.Metadata["triggerName"]; ok {
			parts = append(parts, fmt.Sprintf("name:%v", triggerName))
		}
	}

	// 邮箱地址（使用真实邮箱）
	realMailbox := m.resolveRealMailbox(req.Filter.EmailAddress)
	parts = append(parts, realMailbox)

	// 文件夹列表（排序后拼接）
	if len(req.Filter.Folders) > 0 {
		folders := make([]string, len(req.Filter.Folders))
		copy(folders, req.Filter.Folders)
		sort.Strings(folders)
		parts = append(parts, strings.Join(folders, ","))
	}

	// 主题过滤器
	if req.Filter.Subject != "" {
		parts = append(parts, "subject:"+req.Filter.Subject)
	}

	// 发件人过滤器
	if req.Filter.From != "" {
		parts = append(parts, "from:"+req.Filter.From)
	}

	// 收件人过滤器
	if req.Filter.To != "" {
		parts = append(parts, "to:"+req.Filter.To)
	}

	// 附件过滤器
	if req.Filter.HasAttachment != nil {
		parts = append(parts, fmt.Sprintf("attachment:%v", *req.Filter.HasAttachment))
	}

	// 未读过滤器
	if req.Filter.Unread != nil {
		parts = append(parts, fmt.Sprintf("unread:%v", *req.Filter.Unread))
	}

	// 标签过滤器（排序后拼接）
	if len(req.Filter.Labels) > 0 {
		labels := make([]string, len(req.Filter.Labels))
		copy(labels, req.Filter.Labels)
		sort.Strings(labels)
		parts = append(parts, "labels:"+strings.Join(labels, ","))
	}

	// 自定义过滤器（按键排序）
	if len(req.Filter.CustomFilters) > 0 {
		var customParts []string
		for key, value := range req.Filter.CustomFilters {
			customParts = append(customParts, fmt.Sprintf("%s:%s", key, value))
		}
		sort.Strings(customParts)
		parts = append(parts, "custom:"+strings.Join(customParts, ","))
	}

	// 拼接所有部分
	fingerprintStr := strings.Join(parts, "|")

	// 生成SHA256哈希
	hash := sha256.Sum256([]byte(fingerprintStr))
	fingerprint := fmt.Sprintf("%x", hash)[:16] // 取前16位

	log.Printf("[SubscriptionManager] Generated fingerprint %s for: %s", fingerprint, fingerprintStr)
	return fingerprint
}

// generateSubscriptionFingerprintFromSub 从现有订阅生成指纹
func (m *SubscriptionManager) generateSubscriptionFingerprintFromSub(sub *Subscription) string {
	// 构建一个临时的SubscribeRequest来复用指纹生成逻辑
	req := SubscribeRequest{
		Type:     sub.Type,
		Filter:   sub.Filter,
		Metadata: sub.Metadata, // 包含触发器元数据
	}
	return m.generateSubscriptionFingerprint(req)
}
