package database

import (
	"fmt"
	"log"
	"os"
	"time"

	"mailman/internal/models"

	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"gorm.io/gorm/logger"
)

var DB *gorm.DB
var dbDriver string

// Config holds database configuration
type Config struct {
	Driver   string
	Host     string
	Port     string
	User     string
	Password string
	DBName   string
	SSLMode  string
}

// Initialize sets up the database connection
func Initialize(config Config) error {
	var err error
	var dialector gorm.Dialector

	// Create custom logger
	newLogger := logger.New(
		log.New(os.Stdout, "\r\n", log.LstdFlags),
		logger.Config{
			SlowThreshold:             time.Second,
			LogLevel:                  logger.Warn, // 改为Warn级别，减少数据库操作日志
			IgnoreRecordNotFoundError: true,
			Colorful:                  true,
		},
	)

	gormConfig := &gorm.Config{
		Logger: newLogger,
	}

	dbDriver = config.Driver

	switch config.Driver {
	case "sqlite":
		dialector = sqlite.Open(config.DBName)
	case "mysql":
		dsn := fmt.Sprintf("%s:%s@tcp(%s:%s)/%s?charset=utf8mb4&parseTime=True&loc=Local",
			config.User, config.Password, config.Host, config.Port, config.DBName)
		dialector = mysql.Open(dsn)
	case "postgres":
		dsn := fmt.Sprintf("host=%s user=%s password=%s dbname=%s port=%s sslmode=%s",
			config.Host, config.User, config.Password, config.DBName, config.Port, config.SSLMode)
		dialector = postgres.Open(dsn)
	default:
		return fmt.Errorf("unsupported database driver: %s", config.Driver)
	}

	DB, err = gorm.Open(dialector, gormConfig)
	if err != nil {
		return fmt.Errorf("failed to connect to database: %w", err)
	}

	// Run migrations
	if err := Migrate(); err != nil {
		return fmt.Errorf("failed to run migrations: %w", err)
	}

	return nil
}

// Migrate runs database migrations
func Migrate() error {
	// 首先迁移除了OAuth2GlobalConfig之外的所有表
	if err := DB.AutoMigrate(
		&models.MailProvider{},
		&models.EmailAccount{},
		&models.EmailRoutingAddress{},
		&models.BusinessModule{},
		&models.BusinessAccount{},
		&models.BusinessEmailExclusion{},
		&models.Email{},
		&models.Attachment{},
		&models.Mailbox{},
		&models.IncrementalSyncRecord{},
		&models.ExtractorTemplate{},
		&models.OpenAIConfig{},
		&models.AIPromptTemplate{},
		&models.AIGeneratedTemplate{},
		&models.User{},
		&models.UserSession{},
		&models.UserMenuPreference{},
		&models.EmailAccountSyncConfig{},
		&models.TemporarySyncConfig{},
		&models.GlobalSyncConfig{},
		&models.SyncStatistics{},
		&models.SyncRun{},
		&models.SyncCursor{},
		&models.ActivityLog{},
		&models.EmailTrigger{},
		&models.TriggerExecutionLog{},
		&models.OAuth2AuthSession{},
		&models.SystemConfig{},
		&models.FilterTemplate{},
		&models.ActionTemplate{},
		&models.EmailTriggerV2{},
		&models.TriggerExecutionLogV2{},
		&models.ExtractorTemplateV2{},
		&models.ExtractionLogV2{},
		// Tag system tables
		&models.TagGroup{},
		&models.Tag{},
		&models.EmailAccountTag{},
		// Proxy pool tables
		&models.ProxyGroup{},
		&models.ProxyTag{},
		&models.ProxyPoolItem{},
		&models.ProxyPoolItemTag{},
		// Proxy gateway tables
		&models.ProxyGatewayListener{},
		&models.ProxyGatewayAccount{},
		&models.ProxyGatewayRouteStrategy{},
		&models.ProxyGatewayAccountGroup{},
		&models.ProxyGatewayAccountTag{},
		&models.ProxyGatewayAccountTagLink{},
		&models.ProxyGatewaySecurityPolicy{},
		&models.ProxyGatewayDNSPolicy{},
		&models.ProxyGatewayAccessLog{},
		&models.ProxyGatewayAuditLog{},
		// Organization & RBAC tables
		&models.Organization{},
		&models.Role{},
		&models.Permission{},
		&models.RolePermission{},
		&models.OrgMember{},
	); err != nil {
		return fmt.Errorf("failed to migrate tables: %w", err)
	}

	if err := backfillEmailRoutingAddresses(); err != nil {
		return fmt.Errorf("failed to backfill email routing addresses: %w", err)
	}

	// 单独处理OAuth2GlobalConfig的迁移
	if err := migrateOAuth2GlobalConfig(); err != nil {
		return fmt.Errorf("failed to migrate OAuth2GlobalConfig: %w", err)
	}

	// 初始化组织/角色/权限默认数据
	if err := seedOrganizationDefaults(); err != nil {
		return fmt.Errorf("failed to seed organization defaults: %w", err)
	}

	return nil
}

func backfillEmailRoutingAddresses() error {
	var routeCount int64
	if err := DB.Model(&models.EmailRoutingAddress{}).
		Where("kind = ?", models.EmailRoutingAddressKindForwarded).
		Count(&routeCount).Error; err != nil {
		return err
	}
	if routeCount > 0 {
		return nil
	}

	accounts := make([]models.EmailAccount, 0, 1000)
	return DB.Model(&models.EmailAccount{}).
		Order("id ASC").
		FindInBatches(&accounts, 1000, func(tx *gorm.DB, batch int) error {
			routes := make([]models.EmailRoutingAddress, 0)
			for i := range accounts {
				addresses := models.NormalizeEmailRoutingAddresses(accounts[i].ForwardedAddresses)
				for _, address := range addresses {
					routes = append(routes, models.EmailRoutingAddress{
						AccountID:         accounts[i].ID,
						Address:           address,
						NormalizedAddress: address,
						Kind:              models.EmailRoutingAddressKindForwarded,
					})
				}
			}
			if len(routes) == 0 {
				return nil
			}
			return tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&routes).Error
		}).Error
}

// migrateOAuth2GlobalConfig 处理OAuth2GlobalConfig的完整迁移
func migrateOAuth2GlobalConfig() error {
	// 检查表是否存在
	if !DB.Migrator().HasTable(&models.OAuth2GlobalConfig{}) {
		// 表不存在，直接创建
		if err := DB.AutoMigrate(&models.OAuth2GlobalConfig{}); err != nil {
			return err
		}
		return normalizeOAuth2DefaultConfigs()
	}

	// 处理旧表结构迁移（移除provider_type唯一约束）
	if err := migrateOAuth2ProviderTypeConstraint(); err != nil {
		return fmt.Errorf("failed to migrate provider_type constraint: %w", err)
	}

	// 检查name字段是否存在
	if !DB.Migrator().HasColumn(&models.OAuth2GlobalConfig{}, "name") {
		// 添加name字段（允许为空）
		if err := DB.Exec("ALTER TABLE o_auth2_global_configs ADD COLUMN name TEXT").Error; err != nil {
			return fmt.Errorf("failed to add name column: %w", err)
		}

		// 为现有记录更新name字段（MySQL 使用 CONCAT，SQLite/PostgreSQL 使用 ||）
		var updateSQL string
		if dbDriver == "mysql" {
			updateSQL = "UPDATE o_auth2_global_configs SET name = CONCAT('Default ', provider_type, ' Config') WHERE name IS NULL OR name = ''"
		} else {
			updateSQL = "UPDATE o_auth2_global_configs SET name = 'Default ' || provider_type || ' Config' WHERE name IS NULL OR name = ''"
		}
		if err := DB.Exec(updateSQL).Error; err != nil {
			return fmt.Errorf("failed to update name field for existing records: %w", err)
		}
	}

	// 检查是否需要更新其他字段
	if err := DB.AutoMigrate(&models.OAuth2GlobalConfig{}); err != nil {
		return err
	}

	return normalizeOAuth2DefaultConfigs()
}

// normalizeOAuth2DefaultConfigs ensures each provider group has exactly one default config.
func normalizeOAuth2DefaultConfigs() error {
	var providers []models.MailProviderType
	if err := DB.Model(&models.OAuth2GlobalConfig{}).Distinct("provider_type").Pluck("provider_type", &providers).Error; err != nil {
		return err
	}

	for _, provider := range providers {
		var defaults []models.OAuth2GlobalConfig
		if err := DB.Where("provider_type = ? AND is_default = ?", provider, true).Order("id ASC").Find(&defaults).Error; err != nil {
			return err
		}

		if len(defaults) > 1 {
			for _, config := range defaults[1:] {
				if err := DB.Model(&models.OAuth2GlobalConfig{}).Where("id = ?", config.ID).Update("is_default", false).Error; err != nil {
					return err
				}
			}
			continue
		}

		if len(defaults) == 0 {
			var fallback models.OAuth2GlobalConfig
			err := DB.Where("provider_type = ?", provider).Order("is_enabled DESC, id ASC").First(&fallback).Error
			if err != nil {
				if err == gorm.ErrRecordNotFound {
					continue
				}
				return err
			}
			if err := DB.Model(&models.OAuth2GlobalConfig{}).Where("id = ?", fallback.ID).Update("is_default", true).Error; err != nil {
				return err
			}
		}
	}

	return nil
}

// migrateOAuth2ProviderTypeConstraint 处理provider_type字段的约束迁移
func migrateOAuth2ProviderTypeConstraint() error {
	var indexCount int64

	switch dbDriver {
	case "sqlite":
		DB.Raw(`SELECT COUNT(*) FROM sqlite_master
			WHERE type = 'index'
			AND tbl_name = 'o_auth2_global_configs'
			AND sql LIKE '%UNIQUE%'
			AND sql LIKE '%provider_type%'`).Scan(&indexCount)
	case "postgres":
		DB.Raw(`SELECT COUNT(*) FROM pg_indexes
			WHERE tablename = 'o_auth2_global_configs'
			AND indexdef LIKE '%UNIQUE%'
			AND indexdef LIKE '%provider_type%'`).Scan(&indexCount)
	case "mysql":
		DB.Raw(`SELECT COUNT(*) FROM information_schema.statistics
			WHERE table_schema = DATABASE()
			AND table_name = 'o_auth2_global_configs'
			AND column_name = 'provider_type'
			AND non_unique = 0`).Scan(&indexCount)
	default:
		return fmt.Errorf("unsupported database driver for migration: %s", dbDriver)
	}

	if indexCount > 0 {
		return recreateOAuth2ConfigTable()
	}

	return nil
}

// recreateOAuth2ConfigTable 重建OAuth2GlobalConfig表以移除provider_type的唯一约束
func recreateOAuth2ConfigTable() error {
	// 1. 备份现有数据
	var existingConfigs []models.OAuth2GlobalConfig
	if err := DB.Find(&existingConfigs).Error; err != nil {
		return fmt.Errorf("failed to backup existing configs: %w", err)
	}

	// 2. 删除现有表
	if err := DB.Migrator().DropTable(&models.OAuth2GlobalConfig{}); err != nil {
		return fmt.Errorf("failed to drop existing table: %w", err)
	}

	// 3. 创建新表（使用当前模型定义，没有唯一约束）
	if err := DB.AutoMigrate(&models.OAuth2GlobalConfig{}); err != nil {
		return fmt.Errorf("failed to create new table: %w", err)
	}

	// 4. 恢复数据，但为每个记录添加name字段
	for i, config := range existingConfigs {
		if config.Name == "" {
			config.Name = fmt.Sprintf("Default %s Config %d", config.ProviderType, i+1)
		}
		if err := DB.Create(&config).Error; err != nil {
			return fmt.Errorf("failed to restore config %d: %w", config.ID, err)
		}
	}

	return nil
}

// GetDB returns the database instance
func GetDB() *gorm.DB {
	return DB
}

// GetDBDriver returns the current database driver name
func GetDBDriver() string {
	return dbDriver
}

// Close closes the database connection
func Close() error {
	sqlDB, err := DB.DB()
	if err != nil {
		return err
	}
	return sqlDB.Close()
}

// seedOrganizationDefaults 初始化组织、角色、权限的默认数据
func seedOrganizationDefaults() error {
	// 检查是否已经初始化过（通过检查默认组织是否存在）
	var orgCount int64
	DB.Model(&models.Organization{}).Count(&orgCount)
	if orgCount > 0 {
		// 已有组织数据，跳过初始化
		return nil
	}

	log.Println("[Migration] Seeding organization defaults...")

	// 1. 创建默认组织
	defaultOrg := models.Organization{
		Name:        "Default Organization",
		Slug:        "default",
		Description: "系统默认组织，包含所有已有数据",
		IsActive:    true,
	}
	if err := DB.Create(&defaultOrg).Error; err != nil {
		return fmt.Errorf("failed to create default organization: %w", err)
	}
	log.Printf("[Migration] Created default organization (ID=%d)", defaultOrg.ID)

	// 2. 创建系统角色
	systemRoles := []models.Role{
		{Name: models.RoleSuperAdmin, Description: "超级管理员，管理所有组织和用户", IsSystem: true},
		{Name: models.RoleOrgOwner, Description: "组织拥有者，拥有组织的完全控制权", IsSystem: true},
		{Name: models.RoleOrgAdmin, Description: "组织管理员，管理组织资源和成员", IsSystem: true},
		{Name: models.RoleMember, Description: "普通成员，可以查看和使用资源", IsSystem: true},
		{Name: models.RoleViewer, Description: "只读成员，只能查看资源", IsSystem: true},
	}
	for i := range systemRoles {
		if err := DB.Create(&systemRoles[i]).Error; err != nil {
			return fmt.Errorf("failed to create role %s: %w", systemRoles[i].Name, err)
		}
	}
	log.Printf("[Migration] Created %d system roles", len(systemRoles))

	// 3. 创建权限
	permissions := []models.Permission{
		// 组织管理
		{Resource: models.ResourceOrganization, Action: models.ActionCreate, Description: "创建组织"},
		{Resource: models.ResourceOrganization, Action: models.ActionRead, Description: "查看组织"},
		{Resource: models.ResourceOrganization, Action: models.ActionUpdate, Description: "更新组织"},
		{Resource: models.ResourceOrganization, Action: models.ActionDelete, Description: "删除组织"},
		// 成员管理
		{Resource: models.ResourceOrgMember, Action: models.ActionCreate, Description: "添加成员"},
		{Resource: models.ResourceOrgMember, Action: models.ActionRead, Description: "查看成员"},
		{Resource: models.ResourceOrgMember, Action: models.ActionUpdate, Description: "更新成员角色"},
		{Resource: models.ResourceOrgMember, Action: models.ActionDelete, Description: "移除成员"},
		// 邮箱账户
		{Resource: models.ResourceEmailAccount, Action: models.ActionCreate, Description: "创建邮箱账户"},
		{Resource: models.ResourceEmailAccount, Action: models.ActionRead, Description: "查看邮箱账户"},
		{Resource: models.ResourceEmailAccount, Action: models.ActionUpdate, Description: "更新邮箱账户"},
		{Resource: models.ResourceEmailAccount, Action: models.ActionDelete, Description: "删除邮箱账户"},
		// 邮件
		{Resource: models.ResourceEmail, Action: models.ActionRead, Description: "查看邮件"},
		{Resource: models.ResourceEmail, Action: models.ActionCreate, Description: "发送邮件"},
		// 触发器
		{Resource: models.ResourceTrigger, Action: models.ActionCreate, Description: "创建触发器"},
		{Resource: models.ResourceTrigger, Action: models.ActionRead, Description: "查看触发器"},
		{Resource: models.ResourceTrigger, Action: models.ActionUpdate, Description: "更新触发器"},
		{Resource: models.ResourceTrigger, Action: models.ActionDelete, Description: "删除触发器"},
		// 模板
		{Resource: models.ResourceTemplate, Action: models.ActionCreate, Description: "创建模板"},
		{Resource: models.ResourceTemplate, Action: models.ActionRead, Description: "查看模板"},
		{Resource: models.ResourceTemplate, Action: models.ActionUpdate, Description: "更新模板"},
		{Resource: models.ResourceTemplate, Action: models.ActionDelete, Description: "删除模板"},
		// AI 配置
		{Resource: models.ResourceAIConfig, Action: models.ActionManage, Description: "管理 AI 配置"},
		{Resource: models.ResourceAIConfig, Action: models.ActionRead, Description: "查看 AI 配置"},
		// 系统配置
		{Resource: models.ResourceSystemConfig, Action: models.ActionManage, Description: "管理系统配置"},
		{Resource: models.ResourceSystemConfig, Action: models.ActionRead, Description: "查看系统配置"},
		// 同步配置
		{Resource: models.ResourceSyncConfig, Action: models.ActionManage, Description: "管理同步配置"},
		{Resource: models.ResourceSyncConfig, Action: models.ActionRead, Description: "查看同步配置"},
	}
	for i := range permissions {
		if err := DB.Create(&permissions[i]).Error; err != nil {
			return fmt.Errorf("failed to create permission %s:%s: %w", permissions[i].Resource, permissions[i].Action, err)
		}
	}
	log.Printf("[Migration] Created %d permissions", len(permissions))

	// 4. 创建角色-权限映射
	// 构建角色名到ID的映射
	roleMap := make(map[string]uint)
	for _, r := range systemRoles {
		roleMap[r.Name] = r.ID
	}

	// 构建权限resource:action到ID的映射
	permMap := make(map[string]uint)
	for _, p := range permissions {
		permMap[p.Resource+":"+p.Action] = p.ID
	}

	// 获取所有权限ID
	allPermIDs := make([]uint, 0, len(permissions))
	for _, p := range permissions {
		allPermIDs = append(allPermIDs, p.ID)
	}

	// Super Admin: 拥有所有权限
	for _, permID := range allPermIDs {
		DB.Create(&models.RolePermission{RoleID: roleMap[models.RoleSuperAdmin], PermissionID: permID})
	}

	// Org Owner: 除了系统配置和创建/删除组织外的所有权限
	for _, p := range permissions {
		if p.Resource == models.ResourceSystemConfig && p.Action == models.ActionManage {
			continue
		}
		if p.Resource == models.ResourceOrganization && (p.Action == models.ActionCreate || p.Action == models.ActionDelete) {
			continue
		}
		DB.Create(&models.RolePermission{RoleID: roleMap[models.RoleOrgOwner], PermissionID: p.ID})
	}

	// Org Admin: 资源管理权限 + 成员管理，不能删除/更新组织本身
	for _, p := range permissions {
		if p.Resource == models.ResourceSystemConfig && p.Action == models.ActionManage {
			continue
		}
		if p.Resource == models.ResourceOrganization {
			if p.Action != models.ActionRead {
				continue
			}
		}
		DB.Create(&models.RolePermission{RoleID: roleMap[models.RoleOrgAdmin], PermissionID: p.ID})
	}

	// Member: 读取权限 + 发送邮件
	for _, p := range permissions {
		if p.Action == models.ActionRead {
			DB.Create(&models.RolePermission{RoleID: roleMap[models.RoleMember], PermissionID: p.ID})
		}
		if p.Resource == models.ResourceEmail && p.Action == models.ActionCreate {
			DB.Create(&models.RolePermission{RoleID: roleMap[models.RoleMember], PermissionID: p.ID})
		}
	}

	// Viewer: 只有读取权限
	for _, p := range permissions {
		if p.Action == models.ActionRead {
			DB.Create(&models.RolePermission{RoleID: roleMap[models.RoleViewer], PermissionID: p.ID})
		}
	}

	log.Println("[Migration] Role-permission mappings created")

	// 5. 将现有第一个用户（如果存在）升级为超级管理员并加入默认组织
	var firstUser models.User
	if err := DB.Order("id ASC").First(&firstUser).Error; err == nil {
		// 设置为超级管理员
		DB.Model(&firstUser).Updates(map[string]interface{}{
			"is_super_admin": true,
			"current_org_id": defaultOrg.ID,
		})

		// 添加到默认组织，角色为 org_owner
		orgMember := models.OrgMember{
			OrgID:    defaultOrg.ID,
			UserID:   firstUser.ID,
			RoleID:   roleMap[models.RoleOrgOwner],
			JoinedAt: firstUser.CreatedAt,
		}
		DB.Create(&orgMember)
		log.Printf("[Migration] Upgraded user '%s' to super_admin and org_owner", firstUser.Username)
	}

	log.Println("[Migration] Organization defaults seeded successfully")
	return nil
}
