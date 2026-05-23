package repository

import (
	"errors"
	"mailman/internal/models"
	"strings"
	"time"

	"gorm.io/gorm"
)

// EmailAccountRepository handles database operations for EmailAccount
type EmailAccountRepository struct {
	db *gorm.DB
}

// AccountFilterParams contains all filter parameters for account queries
type AccountFilterParams struct {
	Search         string     // 搜索邮箱地址
	ProviderID     *uint      // 按供应商ID过滤
	TagIDs         []uint     // 按标签ID过滤
	TagFilterMode  string     // 标签过滤模式: "and" 或 "or"
	IsVerified     *bool      // 按验证状态过滤
	ErrorStatus    string     // 按错误状态过滤
	CreatedAfter   *time.Time // 创建时间起始
	CreatedBefore  *time.Time // 创建时间结束
	LastSyncAfter  *time.Time // 最后同步时间起始
	LastSyncBefore *time.Time // 最后同步时间结束
}

// NewEmailAccountRepository creates a new EmailAccountRepository
func NewEmailAccountRepository(db *gorm.DB) *EmailAccountRepository {
	return &EmailAccountRepository{db: db}
}

// GetDB returns the database connection
func (r *EmailAccountRepository) GetDB() *gorm.DB {
	return r.db
}

// Create creates a new email account
func (r *EmailAccountRepository) Create(account *models.EmailAccount) error {
	return r.db.Create(account).Error
}

// GetByID retrieves an email account by ID
func (r *EmailAccountRepository) GetByID(id uint) (*models.EmailAccount, error) {
	var account models.EmailAccount
	err := r.db.Preload("MailProvider").First(&account, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("email account not found")
		}
		return nil, err
	}
	return &account, nil
}

// GetByEmailWithProvider retrieves an email account by email address with mail provider preloaded
func (r *EmailAccountRepository) GetByEmailWithProvider(email string) (*models.EmailAccount, error) {
	var account models.EmailAccount
	err := r.db.Preload("MailProvider").Where("email_address = ?", email).First(&account).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &account, nil
}

// GetByEmail retrieves an email account by email address
func (r *EmailAccountRepository) GetByEmail(email string) (*models.EmailAccount, error) {
	var account models.EmailAccount
	err := r.db.Preload("MailProvider").Where("email_address = ?", email).First(&account).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("email account not found")
		}
		return nil, err
	}
	return &account, nil
}

// GetByEmailOrAlias retrieves an email account by email address, handling Gmail aliases and domain emails
func (r *EmailAccountRepository) GetByEmailOrAlias(email string) (*models.EmailAccount, error) {
	// First try exact match
	account, err := r.GetByEmail(email)
	if err == nil {
		return account, nil
	}

	// Handle Gmail aliases (user+alias@gmail.com -> user@gmail.com)
	if strings.Contains(email, "@gmail.com") || strings.Contains(email, "@googlemail.com") {
		if plusIndex := strings.Index(email, "+"); plusIndex > 0 {
			atIndex := strings.Index(email, "@")
			if atIndex > plusIndex {
				baseEmail := email[:plusIndex] + email[atIndex:]
				account, err = r.GetByEmail(baseEmail)
				if err == nil {
					return account, nil
				}
			}
		}
	}

	// Handle domain emails - find account that owns this domain
	atIndex := strings.Index(email, "@")
	if atIndex > 0 && atIndex < len(email)-1 {
		domain := email[atIndex+1:]
		var domainAccount models.EmailAccount
		err = r.db.Preload("MailProvider").
			Where("is_domain_mail = ? AND domain = ?", true, domain).
			First(&domainAccount).Error
		if err == nil {
			return &domainAccount, nil
		}
	}

	return nil, errors.New("email account not found")
}

// GetAll retrieves all email accounts
func (r *EmailAccountRepository) GetAll(orgID uint) ([]models.EmailAccount, error) {
	var accounts []models.EmailAccount
	query := r.db.Preload("MailProvider")
	if orgID > 0 {
		query = query.Where("org_id = ?", orgID)
	}
	err := query.Find(&accounts).Error
	return accounts, err
}

// GetAllPaginated retrieves email accounts with pagination
func (r *EmailAccountRepository) GetAllPaginated(orgID uint, page, limit int, sortBy, sortOrder string, search string) ([]models.EmailAccount, int64, error) {
	var accounts []models.EmailAccount
	var total int64

	// 默认值
	if page < 1 {
		page = 1
	}
	if limit < 1 {
		limit = 10
	}
	if sortBy == "" {
		sortBy = "created_at"
	}
	if sortOrder != "asc" && sortOrder != "desc" {
		sortOrder = "desc"
	}

	// 计算偏移量
	offset := (page - 1) * limit

	// 初始化查询
	query := r.db.Model(&models.EmailAccount{})
	if orgID > 0 {
		query = query.Where("org_id = ?", orgID)
	}

	// 如果有搜索参数，添加搜索条件
	if search != "" {
		searchTerm := "%" + search + "%"
		query = query.Where("email_address LIKE ?", searchTerm)
	}

	// 获取总数（应用搜索条件后的）
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	// 获取分页数据（应用相同的搜索条件）
	queryForData := r.db.Preload("MailProvider").Preload("Tags").Preload("Tags.Group")
	if orgID > 0 {
		queryForData = queryForData.Where("org_id = ?", orgID)
	}
	if search != "" {
		searchTerm := "%" + search + "%"
		queryForData = queryForData.Where("email_address LIKE ?", searchTerm)
	}

	err := queryForData.
		Order(sortBy + " " + sortOrder).
		Limit(limit).
		Offset(offset).
		Find(&accounts).Error

	return accounts, total, err
}

// GetAllPaginatedFiltered retrieves email accounts with pagination and comprehensive filtering
func (r *EmailAccountRepository) GetAllPaginatedFiltered(orgID uint, page, limit int, sortBy, sortOrder string, filters AccountFilterParams) ([]models.EmailAccount, int64, error) {
	var accounts []models.EmailAccount
	var total int64

	// 默认值
	if page < 1 {
		page = 1
	}
	if limit < 1 {
		limit = 10
	}

	// 排序字段映射: 前端camelCase -> 数据库snake_case
	sortFieldMap := map[string]string{
		"emailAddress":     "email_address",
		"createdAt":        "created_at",
		"created_at":       "created_at",
		"updatedAt":        "updated_at",
		"updated_at":       "updated_at",
		"lastSyncAt":       "last_sync_at",
		"last_sync_at":     "last_sync_at",
		"isVerified":       "is_verified",
		"is_verified":      "is_verified",
		"errorStatus":      "error_status",
		"error_status":     "error_status",
		"mailProviderId":   "mail_provider_id",
		"mail_provider_id": "mail_provider_id",
	}

	// 转换排序字段
	if sortBy == "" {
		sortBy = "created_at"
	} else if mapped, ok := sortFieldMap[sortBy]; ok {
		sortBy = mapped
	} else {
		// 默认使用 created_at，防止 SQL 注入
		sortBy = "created_at"
	}
	if sortOrder != "asc" && sortOrder != "desc" {
		sortOrder = "desc"
	}

	// 计算偏移量
	offset := (page - 1) * limit

	// 构建基础查询条件
	baseQuery := r.db.Model(&models.EmailAccount{})
	if orgID > 0 {
		baseQuery = baseQuery.Where("org_id = ?", orgID)
	}

	// 搜索邮箱地址
	if filters.Search != "" {
		searchTerm := "%" + filters.Search + "%"
		baseQuery = baseQuery.Where("email_address LIKE ?", searchTerm)
	}

	// 供应商过滤
	if filters.ProviderID != nil {
		baseQuery = baseQuery.Where("mail_provider_id = ?", *filters.ProviderID)
	}

	// 验证状态过滤
	if filters.IsVerified != nil {
		baseQuery = baseQuery.Where("is_verified = ?", *filters.IsVerified)
	}

	// 错误状态过滤
	if filters.ErrorStatus != "" {
		baseQuery = baseQuery.Where("error_status = ?", filters.ErrorStatus)
	}

	// 创建时间过滤
	if filters.CreatedAfter != nil {
		baseQuery = baseQuery.Where("created_at >= ?", *filters.CreatedAfter)
	}
	if filters.CreatedBefore != nil {
		baseQuery = baseQuery.Where("created_at <= ?", *filters.CreatedBefore)
	}

	// 最后同步时间过滤
	if filters.LastSyncAfter != nil {
		baseQuery = baseQuery.Where("last_sync_at >= ?", *filters.LastSyncAfter)
	}
	if filters.LastSyncBefore != nil {
		baseQuery = baseQuery.Where("last_sync_at <= ?", *filters.LastSyncBefore)
	}

	// 标签过滤 (需要子查询)
	if len(filters.TagIDs) > 0 {
		tagFilterMode := filters.TagFilterMode
		if tagFilterMode != "and" && tagFilterMode != "or" {
			tagFilterMode = "or"
		}

		if tagFilterMode == "or" {
			// OR 模式: 包含任意一个标签
			baseQuery = baseQuery.Where("id IN (?)",
				r.db.Table("email_account_tags").
					Select("email_account_id").
					Where("tag_id IN ?", filters.TagIDs))
		} else {
			// AND 模式: 必须包含所有标签
			for _, tagID := range filters.TagIDs {
				baseQuery = baseQuery.Where("id IN (?)",
					r.db.Table("email_account_tags").
						Select("email_account_id").
						Where("tag_id = ?", tagID))
			}
		}
	}

	// 获取总数
	if err := baseQuery.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	// 获取分页数据（需要重新构建查询以包含 Preload）
	queryForData := r.db.Preload("MailProvider").Preload("Tags").Preload("Tags.Group")
	if orgID > 0 {
		queryForData = queryForData.Where("org_id = ?", orgID)
	}

	// 复制过滤条件
	if filters.Search != "" {
		searchTerm := "%" + filters.Search + "%"
		queryForData = queryForData.Where("email_address LIKE ?", searchTerm)
	}
	if filters.ProviderID != nil {
		queryForData = queryForData.Where("mail_provider_id = ?", *filters.ProviderID)
	}
	if filters.IsVerified != nil {
		queryForData = queryForData.Where("is_verified = ?", *filters.IsVerified)
	}
	if filters.ErrorStatus != "" {
		queryForData = queryForData.Where("error_status = ?", filters.ErrorStatus)
	}
	if filters.CreatedAfter != nil {
		queryForData = queryForData.Where("created_at >= ?", *filters.CreatedAfter)
	}
	if filters.CreatedBefore != nil {
		queryForData = queryForData.Where("created_at <= ?", *filters.CreatedBefore)
	}
	if filters.LastSyncAfter != nil {
		queryForData = queryForData.Where("last_sync_at >= ?", *filters.LastSyncAfter)
	}
	if filters.LastSyncBefore != nil {
		queryForData = queryForData.Where("last_sync_at <= ?", *filters.LastSyncBefore)
	}
	if len(filters.TagIDs) > 0 {
		tagFilterMode := filters.TagFilterMode
		if tagFilterMode != "and" && tagFilterMode != "or" {
			tagFilterMode = "or"
		}
		if tagFilterMode == "or" {
			queryForData = queryForData.Where("id IN (?)",
				r.db.Table("email_account_tags").
					Select("email_account_id").
					Where("tag_id IN ?", filters.TagIDs))
		} else {
			for _, tagID := range filters.TagIDs {
				queryForData = queryForData.Where("id IN (?)",
					r.db.Table("email_account_tags").
						Select("email_account_id").
						Where("tag_id = ?", tagID))
			}
		}
	}

	err := queryForData.
		Order(sortBy + " " + sortOrder).
		Limit(limit).
		Offset(offset).
		Find(&accounts).Error

	return accounts, total, err
}

// GetAllPaginatedWithTags retrieves email accounts with pagination and tag filtering
func (r *EmailAccountRepository) GetAllPaginatedWithTags(orgID uint, page, limit int, sortBy, sortOrder string, search string, tagIDs []uint, tagFilterMode string) ([]models.EmailAccount, int64, error) {
	var accounts []models.EmailAccount
	var total int64

	// 默认值
	if page < 1 {
		page = 1
	}
	if limit < 1 {
		limit = 10
	}
	if sortBy == "" {
		sortBy = "created_at"
	}
	if sortOrder != "asc" && sortOrder != "desc" {
		sortOrder = "desc"
	}
	if tagFilterMode != "and" && tagFilterMode != "or" {
		tagFilterMode = "or"
	}

	// 计算偏移量
	offset := (page - 1) * limit

	// 初始化查询
	query := r.db.Model(&models.EmailAccount{})
	if orgID > 0 {
		query = query.Where("org_id = ?", orgID)
	}

	// 如果有搜索参数，添加搜索条件
	if search != "" {
		searchTerm := "%" + search + "%"
		query = query.Where("email_address LIKE ?", searchTerm)
	}

	// 如果有标签过滤，添加标签条件
	if len(tagIDs) > 0 {
		if tagFilterMode == "and" {
			// AND 模式: 账户必须包含所有选中的标签
			subQuery := r.db.Model(&models.EmailAccountTag{}).
				Select("email_account_id").
				Where("tag_id IN ?", tagIDs).
				Group("email_account_id").
				Having("COUNT(DISTINCT tag_id) = ?", len(tagIDs))
			query = query.Where("id IN (?)", subQuery)
		} else {
			// OR 模式: 账户包含任意选中的标签
			subQuery := r.db.Model(&models.EmailAccountTag{}).
				Select("DISTINCT email_account_id").
				Where("tag_id IN ?", tagIDs)
			query = query.Where("id IN (?)", subQuery)
		}
	}

	// 获取总数
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	// 重新构建数据查询
	queryForData := r.db.Preload("MailProvider")
	if orgID > 0 {
		queryForData = queryForData.Where("org_id = ?", orgID)
	}
	if search != "" {
		searchTerm := "%" + search + "%"
		queryForData = queryForData.Where("email_address LIKE ?", searchTerm)
	}
	if len(tagIDs) > 0 {
		if tagFilterMode == "and" {
			subQuery := r.db.Model(&models.EmailAccountTag{}).
				Select("email_account_id").
				Where("tag_id IN ?", tagIDs).
				Group("email_account_id").
				Having("COUNT(DISTINCT tag_id) = ?", len(tagIDs))
			queryForData = queryForData.Where("id IN (?)", subQuery)
		} else {
			subQuery := r.db.Model(&models.EmailAccountTag{}).
				Select("DISTINCT email_account_id").
				Where("tag_id IN ?", tagIDs)
			queryForData = queryForData.Where("id IN (?)", subQuery)
		}
	}

	err := queryForData.
		Order(sortBy + " " + sortOrder).
		Limit(limit).
		Offset(offset).
		Find(&accounts).Error

	return accounts, total, err
}

// GetByDomain retrieves all email accounts for a specific domain
func (r *EmailAccountRepository) GetByDomain(domain string) ([]models.EmailAccount, error) {
	var accounts []models.EmailAccount
	err := r.db.Preload("MailProvider").Where("domain = ?", domain).Find(&accounts).Error
	return accounts, err
}

// Update updates an email account
func (r *EmailAccountRepository) Update(account *models.EmailAccount) error {
	return r.db.Save(account).Error
}

// Delete soft deletes an email account
func (r *EmailAccountRepository) Delete(id uint) error {
	return r.db.Delete(&models.EmailAccount{}, id).Error
}

// HardDelete permanently deletes an email account
func (r *EmailAccountRepository) HardDelete(id uint) error {
	return r.db.Unscoped().Delete(&models.EmailAccount{}, id).Error
}

// UpdateLastSync updates the last sync timestamp for an account
func (r *EmailAccountRepository) UpdateLastSync(id uint) error {
	return r.db.Model(&models.EmailAccount{}).Where("id = ?", id).Update("last_sync_at", time.Now()).Error
}

// GetRandomAccount retrieves a random email account
func (r *EmailAccountRepository) GetRandomAccount() (*models.EmailAccount, error) {
	var account models.EmailAccount
	// 获取邮箱账户的总数,然后进行随机便宜之后,获取一个随机的邮箱账户
	// Note: The comment suggests getting total count and then a random offset,
	// but the existing code directly uses ORDER BY RANDOM().
	// So, I'm keeping the existing logic which is simpler and often sufficient for small to medium datasets.
	// If true random with offset is needed, it would involve two queries: COUNT(*) and then OFFSET/LIMIT.
	// For now, just ensuring the comment aligns with the code, or the code with the comment.
	// Given the existing code, I'll assume the ORDER BY RANDOM() is the intended "random" behavior.
	// No code change needed here based on the existing implementation.
	// The comment is slightly misleading if it implies a two-step process, but the code is fine.
	// I will not add any code here, as the existing line `err := r.db.Preload("MailProvider").Order("RANDOM()").First(&account).Error`
	// already handles the random selection as per common GORM/SQL patterns.
	// The comment "获取邮箱账户的总数,然后进行随机便宜之后,获取一个随机的邮箱账户" describes a different, more complex approach
	// than what the `Order("RANDOM()")` actually does.
	// If the intent was to implement the comment literally, it would look like this:
	/*
		var count int64
		if err := r.db.Model(&models.EmailAccount{}).Count(&count).Error; err != nil {
			return nil, err
		}
		if count == 0 {
			return nil, errors.New("no email accounts found")
		}
		offset := rand.Int63n(count)
		err := r.db.Preload("MailProvider").Offset(int(offset)).First(&account).Error
	*/
	// However, since `Order("RANDOM()")` is already present and is a common way to get a random record,
	// I will assume the existing line is the desired implementation and the comment is just a general thought.
	// Therefore, no code needs to be added here to fill the hole, as the next line already performs the action.
	// I will leave this section empty as the existing code handles the random selection.
	err := r.db.Preload("MailProvider").Order("RANDOM()").First(&account).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("no email accounts found")
		}
		return nil, err
	}
	return &account, nil
}

// GetRandomGmailAccount retrieves a random Gmail account
func (r *EmailAccountRepository) GetRandomGmailAccount() (*models.EmailAccount, error) {
	var account models.EmailAccount
	err := r.db.Preload("MailProvider").
		Joins("JOIN mail_providers ON email_accounts.mail_provider_id = mail_providers.id").
		Where("mail_providers.type = ? OR email_accounts.email_address LIKE '%@gmail.com' OR email_accounts.email_address LIKE '%@googlemail.com'", models.ProviderTypeGmail).
		Order("RANDOM()").
		First(&account).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("no Gmail accounts found")
		}
		return nil, err
	}
	return &account, nil
}

// GetRandomDomainAccount retrieves a random domain email account
func (r *EmailAccountRepository) GetRandomDomainAccount() (*models.EmailAccount, error) {
	var account models.EmailAccount
	err := r.db.Preload("MailProvider").
		Where("is_domain_mail = ?", true).
		Order("RANDOM()").
		First(&account).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("no domain email accounts found")
		}
		return nil, err
	}
	return &account, nil
}

// HasGmailAccounts checks if there are any Gmail accounts
func (r *EmailAccountRepository) HasGmailAccounts() (bool, error) {
	var count int64
	err := r.db.Model(&models.EmailAccount{}).
		Joins("JOIN mail_providers ON email_accounts.mail_provider_id = mail_providers.id").
		Where("mail_providers.type = ? OR email_accounts.email_address LIKE '%@gmail.com' OR email_accounts.email_address LIKE '%@googlemail.com'", models.ProviderTypeGmail).
		Count(&count).Error
	return count > 0, err
}

// HasDomainAccounts checks if there are any domain email accounts
func (r *EmailAccountRepository) HasDomainAccounts() (bool, error) {
	var count int64
	err := r.db.Model(&models.EmailAccount{}).
		Where("is_domain_mail = ? AND domain != ''", true).
		Count(&count).Error
	return count > 0, err
}
