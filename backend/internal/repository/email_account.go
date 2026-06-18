package repository

import (
	"context"
	"errors"
	"fmt"
	"mailman/internal/models"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// EmailAccountRepository handles database operations for EmailAccount
type EmailAccountRepository struct {
	db *gorm.DB
}

type AccountDashboardStats struct {
	TotalAccounts    int64
	VerifiedAccounts int64
	ErrorAccounts    int64
}

type AccountAnchorWindow struct {
	Accounts         []models.EmailAccount
	TotalCount       int64
	HasPrev          bool
	HasNext          bool
	AnchorIndex      int
	WindowStartIndex int
	WindowEndIndex   int
}

var emailAccountSortColumns = map[string]string{
	"emailAddress":     "email_address",
	"email_address":    "email_address",
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

// AccountFilterParams contains all filter parameters for account queries
type AccountFilterParams struct {
	Search         string     // 搜索邮箱地址、域名、转发收件地址和备注
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

func accountSortColumn(sortBy string) string {
	if mapped, ok := emailAccountSortColumns[sortBy]; ok {
		return mapped
	}
	return "created_at"
}

func accountSortDirection(sortOrder string) string {
	if strings.EqualFold(sortOrder, "asc") {
		return "ASC"
	}
	return "DESC"
}

func reverseSortDirection(direction string) string {
	if strings.EqualFold(direction, "ASC") {
		return "DESC"
	}
	return "ASC"
}

func buildAccountOrderClause(db *gorm.DB, sortBy, sortOrder string, reverse bool) string {
	column := accountSortColumn(sortBy)
	direction := accountSortDirection(sortOrder)
	if reverse {
		direction = reverseSortDirection(direction)
	}

	return fmt.Sprintf("%s %s, %s %s", quoteColumn(db, column), direction, quoteColumn(db, "id"), direction)
}

func parseAccountCursorValue(column, value string) (interface{}, error) {
	switch column {
	case "created_at", "updated_at", "last_sync_at":
		return time.Parse(time.RFC3339Nano, value)
	case "mail_provider_id":
		parsed, err := strconv.ParseUint(value, 10, 64)
		return uint(parsed), err
	case "is_verified":
		return strconv.ParseBool(value)
	default:
		return value, nil
	}
}

// AccountCursorValue returns the serialized primary sort value for a cursor.
func AccountCursorValue(account models.EmailAccount, sortBy string) string {
	switch accountSortColumn(sortBy) {
	case "created_at":
		return account.CreatedAt.UTC().Format(time.RFC3339Nano)
	case "updated_at":
		return account.UpdatedAt.UTC().Format(time.RFC3339Nano)
	case "last_sync_at":
		if account.LastSyncAt == nil {
			return time.Time{}.UTC().Format(time.RFC3339Nano)
		}
		return account.LastSyncAt.UTC().Format(time.RFC3339Nano)
	case "mail_provider_id":
		if account.MailProviderID == nil {
			return "0"
		}
		return strconv.FormatUint(uint64(*account.MailProviderID), 10)
	case "is_verified":
		return strconv.FormatBool(account.IsVerified)
	case "error_status":
		return account.ErrorStatus
	case "email_address":
		return account.EmailAddress
	default:
		return account.CreatedAt.UTC().Format(time.RFC3339Nano)
	}
}

// NewEmailAccountRepository creates a new EmailAccountRepository
func NewEmailAccountRepository(db *gorm.DB) *EmailAccountRepository {
	return &EmailAccountRepository{db: db}
}

func (r *EmailAccountRepository) accountSearchCondition() string {
	return fmt.Sprintf(
		"(%s OR %s OR %s OR %s)",
		textCaseInsensitiveLikeExpr(r.db, "email_address"),
		textCaseInsensitiveLikeExpr(r.db, "domain"),
		textCaseInsensitiveLikeExpr(r.db, "note"),
		textCaseInsensitiveLikeExpr(r.db, "forwarded_addresses"),
	)
}

// GetDB returns the database connection
func (r *EmailAccountRepository) GetDB() *gorm.DB {
	return r.db
}

// Create creates a new email account
func (r *EmailAccountRepository) Create(account *models.EmailAccount) error {
	account.ForwardedAddresses = models.NormalizeEmailRoutingAddresses(account.ForwardedAddresses)
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(account).Error; err != nil {
			return err
		}
		return replaceAccountRoutingAddresses(tx, account)
	})
}

// GetByID retrieves an email account by ID
func (r *EmailAccountRepository) GetByID(id uint) (*models.EmailAccount, error) {
	return r.GetByIDWithContext(context.Background(), id)
}

func (r *EmailAccountRepository) GetByIDWithContext(ctx context.Context, id uint) (*models.EmailAccount, error) {
	db := r.db
	if ctx != nil {
		db = db.WithContext(ctx)
	}
	var account models.EmailAccount
	err := db.Preload("MailProvider").First(&account, id).Error
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
	return r.GetByEmailWithContext(context.Background(), email)
}

func (r *EmailAccountRepository) GetByEmailWithContext(ctx context.Context, email string) (*models.EmailAccount, error) {
	db := r.db
	if ctx != nil {
		db = db.WithContext(ctx)
	}
	var account models.EmailAccount
	err := db.Preload("MailProvider").Where("email_address = ?", email).First(&account).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("email account not found")
		}
		return nil, err
	}
	return &account, nil
}

// GetByEmailOrAlias retrieves an email account by email address, handling Gmail aliases, forwarding routes, and domain emails
func (r *EmailAccountRepository) GetByEmailOrAlias(email string) (*models.EmailAccount, error) {
	return r.GetByEmailOrAliasWithContext(context.Background(), email)
}

func (r *EmailAccountRepository) GetByEmailOrAliasWithContext(ctx context.Context, email string) (*models.EmailAccount, error) {
	db := r.db
	if ctx != nil {
		db = db.WithContext(ctx)
	}
	// First try exact match
	account, err := r.GetByEmailWithContext(ctx, email)
	if err == nil {
		return account, nil
	}

	// Handle Gmail aliases (user+alias@gmail.com -> user@gmail.com)
	if strings.Contains(email, "@gmail.com") || strings.Contains(email, "@googlemail.com") {
		if plusIndex := strings.Index(email, "+"); plusIndex > 0 {
			atIndex := strings.Index(email, "@")
			if atIndex > plusIndex {
				baseEmail := email[:plusIndex] + email[atIndex:]
				account, err = r.GetByEmailWithContext(ctx, baseEmail)
				if err == nil {
					return account, nil
				}
			}
		}
	}

	// Handle forwarding routes: original recipient addresses that land in this account
	account, err = r.GetByForwardedAddressWithContext(ctx, email)
	if err == nil {
		return account, nil
	}

	// Handle domain emails - find account that owns this domain
	atIndex := strings.Index(email, "@")
	if atIndex > 0 && atIndex < len(email)-1 {
		domain := email[atIndex+1:]
		var domainAccount models.EmailAccount
		err = db.Preload("MailProvider").
			Where("is_domain_mail = ? AND domain = ?", true, domain).
			First(&domainAccount).Error
		if err == nil {
			return &domainAccount, nil
		}
	}

	return nil, errors.New("email account not found")
}

func (r *EmailAccountRepository) GetByForwardedAddress(email string) (*models.EmailAccount, error) {
	return r.GetByForwardedAddressWithContext(context.Background(), email)
}

func (r *EmailAccountRepository) GetByForwardedAddressWithContext(ctx context.Context, email string) (*models.EmailAccount, error) {
	recipient := models.NormalizeEmailRoutingAddress(email)
	if recipient == "" {
		return nil, errors.New("email account not found")
	}

	if account, err := r.getAccountByRoutingAddressWithContext(ctx, recipient); err == nil {
		return account, nil
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	if wildcard := forwardedRoutingWildcardCandidate(recipient); wildcard != "" && wildcard != recipient {
		if account, err := r.getAccountByRoutingAddressWithContext(ctx, wildcard); err == nil {
			return account, nil
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
	}

	return nil, errors.New("email account not found")
}

func (r *EmailAccountRepository) getAccountByRoutingAddress(normalizedAddress string) (*models.EmailAccount, error) {
	return r.getAccountByRoutingAddressWithContext(context.Background(), normalizedAddress)
}

func (r *EmailAccountRepository) getAccountByRoutingAddressWithContext(ctx context.Context, normalizedAddress string) (*models.EmailAccount, error) {
	db := r.db
	if ctx != nil {
		db = db.WithContext(ctx)
	}
	var route models.EmailRoutingAddress
	err := db.
		Where("kind = ? AND normalized_address = ?", models.EmailRoutingAddressKindForwarded, normalizedAddress).
		Order("account_id ASC").
		First(&route).Error
	if err != nil {
		return nil, err
	}

	var account models.EmailAccount
	if err := db.Preload("MailProvider").First(&account, route.AccountID).Error; err != nil {
		return nil, err
	}
	return &account, nil
}

func forwardedRoutingWildcardCandidate(normalizedAddress string) string {
	if strings.HasPrefix(normalizedAddress, "*@") && len(normalizedAddress) > 2 {
		return normalizedAddress
	}

	at := strings.LastIndex(normalizedAddress, "@")
	if at < 0 || at == len(normalizedAddress)-1 {
		return ""
	}
	return "*@" + normalizedAddress[at+1:]
}

func buildForwardedRoutingAddresses(account *models.EmailAccount) []models.EmailRoutingAddress {
	if account == nil || account.ID == 0 {
		return nil
	}

	addresses := models.NormalizeEmailRoutingAddresses(account.ForwardedAddresses)
	account.ForwardedAddresses = addresses

	routes := make([]models.EmailRoutingAddress, 0, len(addresses))
	for _, address := range addresses {
		routes = append(routes, models.EmailRoutingAddress{
			AccountID:         account.ID,
			Address:           address,
			NormalizedAddress: address,
			Kind:              models.EmailRoutingAddressKindForwarded,
		})
	}
	return routes
}

func replaceAccountRoutingAddresses(tx *gorm.DB, account *models.EmailAccount) error {
	if account == nil || account.ID == 0 {
		return nil
	}

	if err := tx.Unscoped().
		Where("account_id = ? AND kind = ?", account.ID, models.EmailRoutingAddressKindForwarded).
		Delete(&models.EmailRoutingAddress{}).Error; err != nil {
		return err
	}

	routes := buildForwardedRoutingAddresses(account)
	if len(routes) == 0 {
		return nil
	}

	return tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&routes).Error
}

// BackfillEmailRoutingAddresses builds the indexed routing projection for accounts created before the projection existed.
func (r *EmailAccountRepository) BackfillEmailRoutingAddresses() error {
	var routeCount int64
	if err := r.db.Model(&models.EmailRoutingAddress{}).
		Where("kind = ?", models.EmailRoutingAddressKindForwarded).
		Count(&routeCount).Error; err != nil {
		return err
	}
	if routeCount > 0 {
		return nil
	}

	accounts := make([]models.EmailAccount, 0, 1000)
	return r.db.Model(&models.EmailAccount{}).
		Order("id ASC").
		FindInBatches(&accounts, 1000, func(tx *gorm.DB, batch int) error {
			routes := make([]models.EmailRoutingAddress, 0)
			for i := range accounts {
				routes = append(routes, buildForwardedRoutingAddresses(&accounts[i])...)
			}
			if len(routes) == 0 {
				return nil
			}
			return tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&routes).Error
		}).Error
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

func (r *EmailAccountRepository) GetByIDs(orgID uint, ids []uint) ([]models.EmailAccount, error) {
	if len(ids) == 0 {
		return []models.EmailAccount{}, nil
	}

	var accounts []models.EmailAccount
	query := r.db.Preload("MailProvider").Where("id IN ?", ids)
	if orgID > 0 {
		query = query.Where("org_id = ?", orgID)
	}
	err := query.Find(&accounts).Error
	return accounts, err
}

func (r *EmailAccountRepository) GetDashboardStats(orgID uint) (AccountDashboardStats, error) {
	return r.GetDashboardStatsWithContext(context.Background(), orgID)
}

func (r *EmailAccountRepository) GetDashboardStatsWithContext(ctx context.Context, orgID uint) (AccountDashboardStats, error) {
	var stats AccountDashboardStats
	if ctx == nil {
		ctx = context.Background()
	}
	query := r.db.WithContext(ctx).Model(&models.EmailAccount{}).Select(
		`COUNT(*) AS total_accounts,
		COALESCE(SUM(CASE WHEN is_verified = ? THEN 1 ELSE 0 END), 0) AS verified_accounts,
		COALESCE(SUM(CASE WHEN error_status IS NOT NULL AND error_status != '' AND error_status != ? THEN 1 ELSE 0 END), 0) AS error_accounts`,
		true,
		models.ErrorStatusNormal,
	)
	if orgID > 0 {
		query = query.Where("org_id = ?", orgID)
	}

	err := query.Scan(&stats).Error
	return stats, err
}

func (r *EmailAccountRepository) applyAccountFilters(query *gorm.DB, orgID uint, filters AccountFilterParams) *gorm.DB {
	if orgID > 0 {
		query = query.Where("org_id = ?", orgID)
	}

	if filters.Search != "" {
		searchTerm := "%" + filters.Search + "%"
		query = query.Where(r.accountSearchCondition(), searchTerm, searchTerm, searchTerm, searchTerm)
	}
	if filters.ProviderID != nil {
		query = query.Where("mail_provider_id = ?", *filters.ProviderID)
	}
	if filters.IsVerified != nil {
		query = query.Where("is_verified = ?", *filters.IsVerified)
	}
	if filters.ErrorStatus != "" {
		query = query.Where("error_status = ?", filters.ErrorStatus)
	}
	if filters.CreatedAfter != nil {
		query = query.Where("created_at >= ?", *filters.CreatedAfter)
	}
	if filters.CreatedBefore != nil {
		query = query.Where("created_at <= ?", *filters.CreatedBefore)
	}
	if filters.LastSyncAfter != nil {
		query = query.Where("last_sync_at >= ?", *filters.LastSyncAfter)
	}
	if filters.LastSyncBefore != nil {
		query = query.Where("last_sync_at <= ?", *filters.LastSyncBefore)
	}
	if len(filters.TagIDs) > 0 {
		tagFilterMode := filters.TagFilterMode
		if tagFilterMode != "and" && tagFilterMode != "or" {
			tagFilterMode = "or"
		}

		if tagFilterMode == "or" {
			query = query.Where("id IN (?)",
				r.db.Table("email_account_tags").
					Select("email_account_id").
					Where("tag_id IN ?", filters.TagIDs))
		} else {
			for _, tagID := range filters.TagIDs {
				query = query.Where("id IN (?)",
					r.db.Table("email_account_tags").
						Select("email_account_id").
						Where("tag_id = ?", tagID))
			}
		}
	}

	return query
}

func (r *EmailAccountRepository) applyAccountKeysetCondition(query *gorm.DB, sortBy, sortOrder string, cursor *KeysetCursor, before bool) (*gorm.DB, error) {
	column := accountSortColumn(sortBy)
	cursorValue, err := parseAccountCursorValue(column, cursor.Value)
	if err != nil {
		return nil, err
	}

	ascending := strings.EqualFold(accountSortDirection(sortOrder), "ASC")
	lessThan := (!ascending && !before) || (ascending && before)
	operator := ">"
	if lessThan {
		operator = "<"
	}

	quotedColumn := quoteColumn(r.db, column)
	quotedID := quoteColumn(r.db, "id")
	return query.Where(
		fmt.Sprintf("(%s %s ? OR (%s = ? AND %s %s ?))", quotedColumn, operator, quotedColumn, quotedID, operator),
		cursorValue,
		cursorValue,
		cursor.ID,
	), nil
}

func reverseAccounts(accounts []models.EmailAccount) {
	for i, j := 0, len(accounts)-1; i < j; i, j = i+1, j-1 {
		accounts[i], accounts[j] = accounts[j], accounts[i]
	}
}

func (r *EmailAccountRepository) searchAccountsFromCursor(orgID uint, sortBy, sortOrder string, filters AccountFilterParams, cursor *KeysetCursor, before bool, limit int) ([]models.EmailAccount, error) {
	var accounts []models.EmailAccount

	query := r.applyAccountFilters(
		r.db.Preload("MailProvider").Preload("Tags").Preload("Tags.Group"),
		orgID,
		filters,
	)
	var err error
	query, err = r.applyAccountKeysetCondition(query, sortBy, sortOrder, cursor, before)
	if err != nil {
		return nil, err
	}

	query = query.Order(buildAccountOrderClause(r.db, sortBy, sortOrder, before))
	if limit > 0 {
		query = query.Limit(limit)
	}

	if err := query.Find(&accounts).Error; err != nil {
		return nil, err
	}
	return accounts, nil
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
	orderClause := buildOrderClause(r.db, sortBy, sortOrder, emailAccountSortColumns, "created_at")

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
		query = query.Where(r.accountSearchCondition(), searchTerm, searchTerm, searchTerm, searchTerm)
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
		queryForData = queryForData.Where(r.accountSearchCondition(), searchTerm, searchTerm, searchTerm, searchTerm)
	}

	err := queryForData.
		Order(orderClause).
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

	orderClause := buildOrderClause(r.db, sortBy, sortOrder, emailAccountSortColumns, "created_at")

	// 计算偏移量
	offset := (page - 1) * limit

	// 构建基础查询条件
	baseQuery := r.db.Model(&models.EmailAccount{})
	if orgID > 0 {
		baseQuery = baseQuery.Where("org_id = ?", orgID)
	}

	// 搜索邮箱地址、域名和备注
	if filters.Search != "" {
		searchTerm := "%" + filters.Search + "%"
		baseQuery = baseQuery.Where(r.accountSearchCondition(), searchTerm, searchTerm, searchTerm, searchTerm)
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
		queryForData = queryForData.Where(r.accountSearchCondition(), searchTerm, searchTerm, searchTerm, searchTerm)
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
		Order(orderClause).
		Limit(limit).
		Offset(offset).
		Find(&accounts).Error

	return accounts, total, err
}

// GetAllPaginatedFilteredKeyset retrieves email accounts with cursor pagination.
// It returns at most limit accounts and reports whether more rows exist in the requested direction.
func (r *EmailAccountRepository) GetAllPaginatedFilteredKeyset(orgID uint, limit int, sortBy, sortOrder string, filters AccountFilterParams, pagination KeysetPagination) ([]models.EmailAccount, int64, bool, error) {
	var accounts []models.EmailAccount
	var total int64

	if limit < 1 {
		limit = 10
	}

	countQuery := r.applyAccountFilters(r.db.Model(&models.EmailAccount{}), orgID, filters)
	if err := countQuery.Count(&total).Error; err != nil {
		return nil, 0, false, err
	}

	query := r.applyAccountFilters(
		r.db.Preload("MailProvider").Preload("Tags").Preload("Tags.Group"),
		orgID,
		filters,
	)
	var err error

	reverseForBefore := false
	if pagination.After != nil || pagination.Before != nil {
		cursor := pagination.After
		if pagination.Before != nil {
			cursor = pagination.Before
			reverseForBefore = true
		}

		query, err = r.applyAccountKeysetCondition(query, sortBy, sortOrder, cursor, reverseForBefore)
		if err != nil {
			return nil, 0, false, err
		}
	}

	query = query.Order(buildAccountOrderClause(r.db, sortBy, sortOrder, reverseForBefore)).Limit(limit + 1)
	if err := query.Find(&accounts).Error; err != nil {
		return nil, 0, false, err
	}

	hasMore := len(accounts) > limit
	if hasMore {
		accounts = accounts[:limit]
	}
	if reverseForBefore {
		for i, j := 0, len(accounts)-1; i < j; i, j = i+1, j-1 {
			accounts[i], accounts[j] = accounts[j], accounts[i]
		}
	}

	return accounts, total, hasMore, nil
}

// SearchAccountsAroundAnchor returns a stable keyset window containing the anchor account.
// The returned metadata describes where that window sits in the full filtered account list.
func (r *EmailAccountRepository) SearchAccountsAroundAnchor(orgID uint, anchorAccountID uint, limit int, sortBy, sortOrder string, filters AccountFilterParams) (AccountAnchorWindow, error) {
	if limit <= 0 {
		limit = 50
	}

	var totalCount int64
	countQuery := r.applyAccountFilters(r.db.Model(&models.EmailAccount{}), orgID, filters)
	if err := countQuery.Count(&totalCount).Error; err != nil {
		return AccountAnchorWindow{}, err
	}

	var anchor models.EmailAccount
	anchorQuery := r.applyAccountFilters(
		r.db.Preload("MailProvider").Preload("Tags").Preload("Tags.Group"),
		orgID,
		filters,
	)
	if err := anchorQuery.Where("id = ?", anchorAccountID).First(&anchor).Error; err != nil {
		return AccountAnchorWindow{TotalCount: totalCount}, err
	}

	anchorCursor := &KeysetCursor{
		Value: AccountCursorValue(anchor, sortBy),
		ID:    anchor.ID,
	}

	beforeCountQuery := r.applyAccountFilters(r.db.Model(&models.EmailAccount{}), orgID, filters)
	beforeCountQuery, err := r.applyAccountKeysetCondition(beforeCountQuery, sortBy, sortOrder, anchorCursor, true)
	if err != nil {
		return AccountAnchorWindow{TotalCount: totalCount}, err
	}
	var rowsBeforeAnchor int64
	if err := beforeCountQuery.Count(&rowsBeforeAnchor).Error; err != nil {
		return AccountAnchorWindow{TotalCount: totalCount}, err
	}
	anchorIndex := int(rowsBeforeAnchor) + 1

	probeLimit := limit + 1
	beforeProbe, err := r.searchAccountsFromCursor(orgID, sortBy, sortOrder, filters, anchorCursor, true, probeLimit)
	if err != nil {
		return AccountAnchorWindow{TotalCount: totalCount}, err
	}
	afterProbe, err := r.searchAccountsFromCursor(orgID, sortBy, sortOrder, filters, anchorCursor, false, probeLimit)
	if err != nil {
		return AccountAnchorWindow{TotalCount: totalCount}, err
	}

	beforeWant := (limit - 1) / 2
	afterWant := limit - 1 - beforeWant
	beforeCount := minInt(len(beforeProbe), beforeWant)
	afterCount := minInt(len(afterProbe), afterWant)

	remaining := limit - 1 - beforeCount - afterCount
	if remaining > 0 && len(afterProbe) > afterCount {
		added := minInt(remaining, len(afterProbe)-afterCount)
		afterCount += added
		remaining -= added
	}
	if remaining > 0 && len(beforeProbe) > beforeCount {
		beforeCount += minInt(remaining, len(beforeProbe)-beforeCount)
	}

	hasPrev := len(beforeProbe) > beforeCount
	hasNext := len(afterProbe) > afterCount

	beforeAccounts := append([]models.EmailAccount(nil), beforeProbe[:beforeCount]...)
	reverseAccounts(beforeAccounts)

	accounts := make([]models.EmailAccount, 0, len(beforeAccounts)+1+afterCount)
	accounts = append(accounts, beforeAccounts...)
	accounts = append(accounts, anchor)
	accounts = append(accounts, afterProbe[:afterCount]...)

	windowStartIndex := anchorIndex - beforeCount
	windowEndIndex := windowStartIndex + len(accounts) - 1

	return AccountAnchorWindow{
		Accounts:         accounts,
		TotalCount:       totalCount,
		HasPrev:          hasPrev,
		HasNext:          hasNext,
		AnchorIndex:      anchorIndex,
		WindowStartIndex: windowStartIndex,
		WindowEndIndex:   windowEndIndex,
	}, nil
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
	orderClause := buildOrderClause(r.db, sortBy, sortOrder, emailAccountSortColumns, "created_at")
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
		query = query.Where(r.accountSearchCondition(), searchTerm, searchTerm, searchTerm, searchTerm)
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
		queryForData = queryForData.Where(r.accountSearchCondition(), searchTerm, searchTerm, searchTerm, searchTerm)
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
		Order(orderClause).
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
	return r.UpdateWithContext(context.Background(), account)
}

func (r *EmailAccountRepository) UpdateWithContext(ctx context.Context, account *models.EmailAccount) error {
	db := r.db
	if ctx != nil {
		db = db.WithContext(ctx)
	}
	account.ForwardedAddresses = models.NormalizeEmailRoutingAddresses(account.ForwardedAddresses)
	return db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Save(account).Error; err != nil {
			return err
		}
		return replaceAccountRoutingAddresses(tx, account)
	})
}

// Delete soft deletes an email account
func (r *EmailAccountRepository) Delete(id uint) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Unscoped().
			Where("account_id = ?", id).
			Delete(&models.EmailRoutingAddress{}).Error; err != nil {
			return err
		}
		return tx.Delete(&models.EmailAccount{}, id).Error
	})
}

// HardDelete permanently deletes an email account
func (r *EmailAccountRepository) HardDelete(id uint) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Unscoped().
			Where("account_id = ?", id).
			Delete(&models.EmailRoutingAddress{}).Error; err != nil {
			return err
		}
		return tx.Unscoped().Delete(&models.EmailAccount{}, id).Error
	})
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
