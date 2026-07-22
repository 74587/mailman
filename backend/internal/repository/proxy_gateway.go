package repository

import (
	"errors"
	"mailman/internal/models"
	"regexp"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type ProxyGatewayRepository struct {
	db *gorm.DB
}

func (r *ProxyGatewayRepository) notDeleted(query *gorm.DB) *gorm.DB {
	if r.db.Dialector.Name() == "mysql" {
		return query.Where("(deleted_at IS NULL OR deleted_at = ? OR deleted_at = ?)", "0000-00-00 00:00:00", "0001-01-01 00:00:00")
	}
	return query.Where("(deleted_at IS NULL OR deleted_at = ?)", time.Time{})
}

type ProxyGatewayAccountFilter struct {
	Search   string
	Enabled  *bool
	GroupIDs []uint
	TagIDs   []uint
	TagMode  string
	Page     int
	Limit    int
}

type ProxyGatewayLogFilter struct {
	AccountID   *uint
	AccountName string
	ListenerID  *uint
	SourceIP    string
	Target      string
	TargetMatch string
	Status      string
	Protocol    string
	Search      string
	StartTime   *time.Time
	EndTime     *time.Time
	Page        int
	Limit       int
}

func NewProxyGatewayRepository(db *gorm.DB) *ProxyGatewayRepository {
	return &ProxyGatewayRepository{db: db}
}

func (r *ProxyGatewayRepository) Transaction(fn func(*ProxyGatewayRepository) error) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		return fn(NewProxyGatewayRepository(tx))
	})
}

func (r *ProxyGatewayRepository) GetDB() *gorm.DB {
	return r.db
}

func (r *ProxyGatewayRepository) EnsureDefaults(orgID uint) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var securityCount int64
		if err := tx.Model(&models.ProxyGatewaySecurityPolicy{}).Where("org_id = ? AND gateway_id = ?", orgID, 0).Count(&securityCount).Error; err != nil {
			return err
		}
		if securityCount == 0 {
			if err := tx.Create(DefaultProxyGatewaySecurityPolicy(orgID, 0)).Error; err != nil {
				return err
			}
		}

		var dnsCount int64
		if err := tx.Model(&models.ProxyGatewayDNSPolicy{}).Where("org_id = ? AND gateway_id = ?", orgID, 0).Count(&dnsCount).Error; err != nil {
			return err
		}
		if dnsCount == 0 {
			if err := tx.Create(DefaultProxyGatewayDNSPolicy(orgID, 0)).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func (r *ProxyGatewayRepository) EnsureGatewayDefaults(orgID, gatewayID uint) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var securityCount int64
		if err := tx.Model(&models.ProxyGatewaySecurityPolicy{}).Where("org_id = ? AND gateway_id = ?", orgID, gatewayID).Count(&securityCount).Error; err != nil {
			return err
		}
		if securityCount == 0 {
			if err := tx.Create(DefaultProxyGatewaySecurityPolicy(orgID, gatewayID)).Error; err != nil {
				return err
			}
		}

		var dnsCount int64
		if err := tx.Model(&models.ProxyGatewayDNSPolicy{}).Where("org_id = ? AND gateway_id = ?", orgID, gatewayID).Count(&dnsCount).Error; err != nil {
			return err
		}
		if dnsCount == 0 {
			if err := tx.Create(DefaultProxyGatewayDNSPolicy(orgID, gatewayID)).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func DefaultProxyGatewaySecurityPolicy(orgID, gatewayID uint) *models.ProxyGatewaySecurityPolicy {
	return &models.ProxyGatewaySecurityPolicy{
		OrgID:                  orgID,
		GatewayID:              gatewayID,
		Name:                   "默认安全策略",
		Description:            "默认阻断内网、回环、链路本地、多播和云 metadata 地址。",
		IsDefault:              true,
		BlockPrivateIP:         true,
		BlockLoopback:          true,
		BlockLinkLocal:         true,
		BlockMulticast:         true,
		BlockMetadataIP:        true,
		DNSRebindingProtection: true,
		NoMatchAction:          models.ProxyGatewayPolicyDeny,
	}
}

func DefaultProxyGatewayDNSPolicy(orgID, gatewayID uint) *models.ProxyGatewayDNSPolicy {
	return &models.ProxyGatewayDNSPolicy{
		OrgID:                   orgID,
		GatewayID:               gatewayID,
		Name:                    "默认 DNS 策略",
		Description:             "默认优先远端解析，安全检查会预解析目标域名。",
		IsDefault:               true,
		Mode:                    models.ProxyGatewayDNSRemote,
		Socks5RemoteResolve:     true,
		HTTPConnectPreserveHost: true,
		PreResolveForSecurity:   true,
		CacheTTLSeconds:         300,
		NegativeTTLSeconds:      60,
		MultiIPStrategy:         models.ProxyGatewayMultiIPCheckAll,
		ResolveFailureAction:    models.ProxyGatewayResolveFailureDeny,
	}
}

func (r *ProxyGatewayRepository) ListListeners(orgID uint) ([]models.ProxyGatewayListener, error) {
	var items []models.ProxyGatewayListener
	err := r.db.Preload("SecurityPolicy").Preload("DNSPolicy").
		Where("org_id = ?", orgID).
		Order("enabled DESC, port ASC, id ASC").
		Find(&items).Error
	return items, err
}

func (r *ProxyGatewayRepository) ListEnabledListeners() ([]models.ProxyGatewayListener, error) {
	var items []models.ProxyGatewayListener
	err := r.db.Preload("SecurityPolicy").Preload("DNSPolicy").
		Where("enabled = ?", true).
		Order("org_id ASC, port ASC").
		Find(&items).Error
	return items, err
}

func (r *ProxyGatewayRepository) GetListener(orgID, id uint) (*models.ProxyGatewayListener, error) {
	var item models.ProxyGatewayListener
	err := r.db.Preload("SecurityPolicy").Preload("DNSPolicy").
		First(&item, "org_id = ? AND id = ?", orgID, id).Error
	return &item, err
}

func (r *ProxyGatewayRepository) SaveListener(item *models.ProxyGatewayListener) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if item.ID == 0 {
			var count int64
			if err := tx.Model(&models.ProxyGatewayListener{}).Where("org_id = ?", item.OrgID).Count(&count).Error; err != nil {
				return err
			}
			if count == 0 {
				item.IsDefault = true
			}
		}
		if item.IsDefault {
			if err := tx.Model(&models.ProxyGatewayListener{}).Where("org_id = ? AND id <> ?", item.OrgID, item.ID).Update("is_default", false).Error; err != nil {
				return err
			}
		}
		// Route strategies are preloaded for reads. Persist only their foreign-key
		// fields here; otherwise a stale preloaded association can overwrite a new
		// route_strategy_id or fallback_route_strategy_id during an edit.
		return tx.Select("*").Omit("RouteStrategy", "FallbackRouteStrategy").Save(item).Error
	})
}

func (r *ProxyGatewayRepository) DeleteListener(orgID, id uint) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var item models.ProxyGatewayListener
		_ = tx.First(&item, "org_id = ? AND id = ?", orgID, id).Error
		if err := tx.Where("org_id = ? AND gateway_id = ?", orgID, id).Delete(&models.ProxyGatewayAccountRouteStrategyOverride{}).Error; err != nil {
			return err
		}
		if err := tx.Where("org_id = ? AND id = ?", orgID, id).Delete(&models.ProxyGatewayListener{}).Error; err != nil {
			return err
		}
		if item.IsDefault {
			var next models.ProxyGatewayListener
			if err := tx.Where("org_id = ?", orgID).Order("enabled DESC, id ASC").First(&next).Error; err == nil {
				if err := tx.Model(&models.ProxyGatewayListener{}).Where("org_id = ? AND id = ?", orgID, next.ID).Update("is_default", true).Error; err != nil {
					return err
				}
			}
		}
		return nil
	})
}

func (r *ProxyGatewayRepository) ListAccounts(orgID uint, filter ProxyGatewayAccountFilter) ([]models.ProxyGatewayAccount, int64, error) {
	if filter.Page < 1 {
		filter.Page = 1
	}
	if filter.Limit < 1 {
		filter.Limit = 20
	}
	if filter.Limit > 200 {
		filter.Limit = 200
	}
	query := r.applyAccountFilter(r.db.Model(&models.ProxyGatewayAccount{}), orgID, filter)
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var items []models.ProxyGatewayAccount
	err := r.applyAccountFilter(r.db.Model(&models.ProxyGatewayAccount{}), orgID, filter).
		Preload("Group").Preload("Tags").Preload("SecurityPolicy").Preload("DNSPolicy").
		Preload("RouteStrategyOverrides.SourceRouteStrategy").
		Preload("RouteStrategyOverrides.SourceRouteStrategy.SecurityPolicy").
		Preload("RouteStrategyOverrides.SourceRouteStrategy.DNSPolicy").
		Preload("RouteStrategyOverrides.ReplacementRouteStrategy").
		Preload("RouteStrategyOverrides.ReplacementRouteStrategy.SecurityPolicy").
		Preload("RouteStrategyOverrides.ReplacementRouteStrategy.DNSPolicy").
		Order("updated_at DESC").
		Limit(filter.Limit).
		Offset((filter.Page - 1) * filter.Limit).
		Find(&items).Error
	return items, total, err
}

func (r *ProxyGatewayRepository) applyAccountFilter(query *gorm.DB, orgID uint, filter ProxyGatewayAccountFilter) *gorm.DB {
	query = query.Where("org_id = ?", orgID)
	if filter.Search != "" {
		term := "%" + strings.TrimSpace(filter.Search) + "%"
		query = query.Where("(username LIKE ? OR name LIKE ? OR remark LIKE ?)", term, term, term)
	}
	if filter.Enabled != nil {
		query = query.Where("enabled = ?", *filter.Enabled)
	}
	if len(filter.GroupIDs) > 0 {
		query = query.Where("group_id IN ?", filter.GroupIDs)
	}
	if len(filter.TagIDs) > 0 {
		sub := r.db.Model(&models.ProxyGatewayAccountTagLink{}).Select("account_id").Where("tag_id IN ?", filter.TagIDs)
		if strings.ToLower(filter.TagMode) == "and" {
			sub = sub.Group("account_id").Having("COUNT(DISTINCT tag_id) = ?", len(filter.TagIDs))
		}
		query = query.Where("id IN (?)", sub)
	}
	return query
}

func (r *ProxyGatewayRepository) GetAccount(orgID, id uint) (*models.ProxyGatewayAccount, error) {
	var item models.ProxyGatewayAccount
	err := r.db.Preload("Group").Preload("Tags").Preload("SecurityPolicy").Preload("DNSPolicy").
		Preload("RouteStrategyOverrides.SourceRouteStrategy").
		Preload("RouteStrategyOverrides.SourceRouteStrategy.SecurityPolicy").
		Preload("RouteStrategyOverrides.SourceRouteStrategy.DNSPolicy").
		Preload("RouteStrategyOverrides.ReplacementRouteStrategy").
		Preload("RouteStrategyOverrides.ReplacementRouteStrategy.SecurityPolicy").
		Preload("RouteStrategyOverrides.ReplacementRouteStrategy.DNSPolicy").
		First(&item, "org_id = ? AND id = ?", orgID, id).Error
	return &item, err
}

func (r *ProxyGatewayRepository) GetAccountByUsername(orgID uint, username string) (*models.ProxyGatewayAccount, error) {
	var item models.ProxyGatewayAccount
	err := r.db.Preload("Group").Preload("Tags").Preload("SecurityPolicy").Preload("DNSPolicy").
		Preload("RouteStrategyOverrides.SourceRouteStrategy").
		Preload("RouteStrategyOverrides.SourceRouteStrategy.SecurityPolicy").
		Preload("RouteStrategyOverrides.SourceRouteStrategy.DNSPolicy").
		Preload("RouteStrategyOverrides.ReplacementRouteStrategy").
		Preload("RouteStrategyOverrides.ReplacementRouteStrategy.SecurityPolicy").
		Preload("RouteStrategyOverrides.ReplacementRouteStrategy.DNSPolicy").
		First(&item, "org_id = ? AND username = ?", orgID, username).Error
	return &item, err
}

func (r *ProxyGatewayRepository) IsAccountUsernameAvailable(orgID uint, username string, excludeID uint) (bool, error) {
	query := r.db.Model(&models.ProxyGatewayAccount{}).Where("org_id = ? AND username = ?", orgID, username)
	if excludeID != 0 {
		query = query.Where("id <> ?", excludeID)
	}
	var count int64
	if err := query.Count(&count).Error; err != nil {
		return false, err
	}
	return count == 0, nil
}

func (r *ProxyGatewayRepository) SaveAccount(item *models.ProxyGatewayAccount) error {
	return r.db.Select("*").Save(item).Error
}

func (r *ProxyGatewayRepository) DeleteAccount(orgID, id uint) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("org_id = ? AND account_id = ?", orgID, id).Delete(&models.ProxyGatewayAccountRouteStrategyOverride{}).Error; err != nil {
			return err
		}
		return tx.Where("org_id = ? AND id = ?", orgID, id).Delete(&models.ProxyGatewayAccount{}).Error
	})
}

func (r *ProxyGatewayRepository) SetAccountRouteStrategyOverrides(orgID, accountID uint, overrides []models.ProxyGatewayAccountRouteStrategyOverride) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("org_id = ? AND account_id = ?", orgID, accountID).Delete(&models.ProxyGatewayAccountRouteStrategyOverride{}).Error; err != nil {
			return err
		}
		if len(overrides) == 0 {
			return nil
		}
		items := make([]models.ProxyGatewayAccountRouteStrategyOverride, 0, len(overrides))
		for _, override := range overrides {
			items = append(items, models.ProxyGatewayAccountRouteStrategyOverride{
				OrgID:                      orgID,
				AccountID:                  accountID,
				GatewayID:                  override.GatewayID,
				SourceRouteStrategyID:      override.SourceRouteStrategyID,
				ReplacementRouteStrategyID: override.ReplacementRouteStrategyID,
			})
		}
		return tx.Create(&items).Error
	})
}

func (r *ProxyGatewayRepository) ListRouteStrategies(orgID uint, gatewayID *uint) ([]models.ProxyGatewayRouteStrategy, error) {
	var items []models.ProxyGatewayRouteStrategy
	query := r.db.Preload("SecurityPolicy").Preload("DNSPolicy").Where("org_id = ?", orgID)
	if gatewayID != nil {
		query = query.Where("gateway_id = ?", *gatewayID)
	}
	err := query.
		Order("enabled DESC, flag_no ASC, id ASC").
		Find(&items).Error
	return items, err
}

func (r *ProxyGatewayRepository) GetRouteStrategy(orgID, id uint) (*models.ProxyGatewayRouteStrategy, error) {
	var item models.ProxyGatewayRouteStrategy
	err := r.db.Preload("SecurityPolicy").Preload("DNSPolicy").
		First(&item, "org_id = ? AND id = ?", orgID, id).Error
	return &item, err
}

func (r *ProxyGatewayRepository) GetRouteStrategyByFlagNo(orgID, gatewayID uint, flagNo int) (*models.ProxyGatewayRouteStrategy, error) {
	var item models.ProxyGatewayRouteStrategy
	err := r.db.Preload("SecurityPolicy").Preload("DNSPolicy").
		First(&item, "org_id = ? AND gateway_id = ? AND flag_no = ? AND enabled = ?", orgID, gatewayID, flagNo, true).Error
	if errors.Is(err, gorm.ErrRecordNotFound) && gatewayID != 0 {
		err = r.db.Preload("SecurityPolicy").Preload("DNSPolicy").
			First(&item, "org_id = ? AND gateway_id = ? AND flag_no = ? AND enabled = ?", orgID, 0, flagNo, true).Error
	}
	return &item, err
}

func (r *ProxyGatewayRepository) SaveRouteStrategy(item *models.ProxyGatewayRouteStrategy) error {
	return r.db.Select("*").Save(item).Error
}

func (r *ProxyGatewayRepository) RouteStrategyFlagExists(orgID, gatewayID uint, flagNo int, excludeID uint) (bool, error) {
	query := r.db.Model(&models.ProxyGatewayRouteStrategy{}).
		Where("org_id = ? AND gateway_id = ? AND flag_no = ?", orgID, gatewayID, flagNo)
	if excludeID != 0 {
		query = query.Where("id <> ?", excludeID)
	}
	var count int64
	if err := query.Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}

func (r *ProxyGatewayRepository) DeleteRouteStrategy(orgID, id uint) error {
	var targetRouteCount int64
	if err := r.db.Model(&models.ProxyGatewayTargetRoute{}).
		Where("org_id = ? AND (route_strategy_id = ? OR fallback_route_strategy_id = ?)", orgID, id, id).
		Count(&targetRouteCount).Error; err != nil {
		return err
	}
	if targetRouteCount > 0 {
		return errors.New("route strategy is still referenced by a target route")
	}
	var overrideCount int64
	if err := r.db.Model(&models.ProxyGatewayAccountRouteStrategyOverride{}).
		Where("org_id = ? AND (source_route_strategy_id = ? OR replacement_route_strategy_id = ?)", orgID, id, id).
		Count(&overrideCount).Error; err != nil {
		return err
	}
	if overrideCount > 0 {
		return errors.New("route strategy is still referenced by a gateway account override")
	}
	return r.db.Where("org_id = ? AND id = ?", orgID, id).Delete(&models.ProxyGatewayRouteStrategy{}).Error
}

func (r *ProxyGatewayRepository) CountEnabledTargetRoutesByStrategy(orgID, strategyID uint) (int64, error) {
	var count int64
	err := r.db.Model(&models.ProxyGatewayTargetRoute{}).
		Where("org_id = ? AND enabled = ? AND (route_strategy_id = ? OR (failover_enabled = ? AND fallback_route_strategy_id = ?))", orgID, true, strategyID, true, strategyID).
		Count(&count).Error
	return count, err
}

func (r *ProxyGatewayRepository) ListEnabledTargetRouteGatewayIDsByStrategy(orgID, strategyID uint) ([]uint, error) {
	var gatewayIDs []uint
	err := r.db.Model(&models.ProxyGatewayTargetRoute{}).
		Where("org_id = ? AND enabled = ? AND (route_strategy_id = ? OR (failover_enabled = ? AND fallback_route_strategy_id = ?))", orgID, true, strategyID, true, strategyID).
		Distinct("gateway_id").
		Order("gateway_id ASC").
		Pluck("gateway_id", &gatewayIDs).Error
	return gatewayIDs, err
}

func (r *ProxyGatewayRepository) ListTargetRoutes(orgID uint, gatewayID *uint) ([]models.ProxyGatewayTargetRoute, error) {
	var items []models.ProxyGatewayTargetRoute
	query := r.db.
		Preload("RouteStrategy.SecurityPolicy").
		Preload("RouteStrategy.DNSPolicy").
		Preload("FallbackRouteStrategy.SecurityPolicy").
		Preload("FallbackRouteStrategy.DNSPolicy").
		Where("org_id = ?", orgID)
	if gatewayID != nil {
		query = query.Where("gateway_id = ?", *gatewayID)
	}
	err := query.Order("is_default ASC, sort_order ASC, id ASC").Find(&items).Error
	return items, err
}

func (r *ProxyGatewayRepository) ListEnabledTargetRoutes(orgID, gatewayID uint) ([]models.ProxyGatewayTargetRoute, error) {
	var items []models.ProxyGatewayTargetRoute
	err := r.db.
		Preload("RouteStrategy.SecurityPolicy").
		Preload("RouteStrategy.DNSPolicy").
		Preload("FallbackRouteStrategy.SecurityPolicy").
		Preload("FallbackRouteStrategy.DNSPolicy").
		Where("org_id = ? AND gateway_id = ? AND enabled = ?", orgID, gatewayID, true).
		Order("is_default ASC, sort_order ASC, id ASC").
		Find(&items).Error
	return items, err
}

func (r *ProxyGatewayRepository) GetTargetRoute(orgID, id uint) (*models.ProxyGatewayTargetRoute, error) {
	var item models.ProxyGatewayTargetRoute
	err := r.db.
		Preload("RouteStrategy.SecurityPolicy").
		Preload("RouteStrategy.DNSPolicy").
		Preload("FallbackRouteStrategy.SecurityPolicy").
		Preload("FallbackRouteStrategy.DNSPolicy").
		First(&item, "org_id = ? AND id = ?", orgID, id).Error
	return &item, err
}

func (r *ProxyGatewayRepository) SaveTargetRoute(item *models.ProxyGatewayTargetRoute) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if item.IsDefault {
			// Serialize default-route changes for the same gateway. This prevents
			// concurrent writers from both clearing the old default and then
			// committing two new defaults on databases with row-level locking.
			var gateway models.ProxyGatewayListener
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
				Select("id").
				First(&gateway, "org_id = ? AND id = ?", item.OrgID, item.GatewayID).Error; err != nil {
				return err
			}
			if err := tx.Model(&models.ProxyGatewayTargetRoute{}).
				Where("org_id = ? AND gateway_id = ? AND id <> ?", item.OrgID, item.GatewayID, item.ID).
				Update("is_default", false).Error; err != nil {
				return err
			}
		}
		return tx.Select("*").Save(item).Error
	})
}

func (r *ProxyGatewayRepository) DeleteTargetRoute(orgID, id uint) error {
	return r.db.Where("org_id = ? AND id = ?", orgID, id).Delete(&models.ProxyGatewayTargetRoute{}).Error
}

func (r *ProxyGatewayRepository) SetAccountTags(accountID uint, tagIDs []uint) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("account_id = ?", accountID).Delete(&models.ProxyGatewayAccountTagLink{}).Error; err != nil {
			return err
		}
		for _, tagID := range uniqueUintIDs(tagIDs) {
			if err := tx.Create(&models.ProxyGatewayAccountTagLink{AccountID: accountID, TagID: tagID}).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func (r *ProxyGatewayRepository) ListAccountGroups(orgID uint) ([]models.ProxyGatewayAccountGroup, error) {
	var items []models.ProxyGatewayAccountGroup
	err := r.notDeleted(r.db.Unscoped().Where("org_id = ?", orgID)).Order("sort_order ASC, name ASC").Find(&items).Error
	return items, err
}

func (r *ProxyGatewayRepository) SaveAccountGroup(item *models.ProxyGatewayAccountGroup) error {
	return r.db.Select("*").Save(item).Error
}

func (r *ProxyGatewayRepository) DeleteAccountGroup(orgID, id uint) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&models.ProxyGatewayAccount{}).Where("org_id = ? AND group_id = ?", orgID, id).Update("group_id", nil).Error; err != nil {
			return err
		}
		return tx.Unscoped().Where("org_id = ? AND id = ?", orgID, id).Delete(&models.ProxyGatewayAccountGroup{}).Error
	})
}

func (r *ProxyGatewayRepository) ListAccountTags(orgID uint) ([]models.ProxyGatewayAccountTag, error) {
	var items []models.ProxyGatewayAccountTag
	err := r.notDeleted(r.db.Unscoped().Where("org_id = ?", orgID)).Order("sort_order ASC, name ASC").Find(&items).Error
	return items, err
}

func (r *ProxyGatewayRepository) SaveAccountTag(item *models.ProxyGatewayAccountTag) error {
	return r.db.Select("*").Save(item).Error
}

func (r *ProxyGatewayRepository) DeleteAccountTag(orgID, id uint) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("tag_id = ?", id).Delete(&models.ProxyGatewayAccountTagLink{}).Error; err != nil {
			return err
		}
		return tx.Unscoped().Where("org_id = ? AND id = ?", orgID, id).Delete(&models.ProxyGatewayAccountTag{}).Error
	})
}

func (r *ProxyGatewayRepository) ListSecurityPolicies(orgID uint, gatewayID *uint) ([]models.ProxyGatewaySecurityPolicy, error) {
	var items []models.ProxyGatewaySecurityPolicy
	query := r.db.Where("org_id = ?", orgID)
	if gatewayID != nil {
		query = query.Where("gateway_id = ?", *gatewayID)
	}
	err := query.Order("is_default DESC, updated_at DESC").Find(&items).Error
	return items, err
}

func (r *ProxyGatewayRepository) GetSecurityPolicy(orgID, id uint) (*models.ProxyGatewaySecurityPolicy, error) {
	var item models.ProxyGatewaySecurityPolicy
	err := r.db.First(&item, "org_id = ? AND id = ?", orgID, id).Error
	return &item, err
}

func (r *ProxyGatewayRepository) SaveSecurityPolicy(item *models.ProxyGatewaySecurityPolicy) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if item.IsDefault {
			if err := tx.Model(&models.ProxyGatewaySecurityPolicy{}).
				Where("org_id = ? AND gateway_id = ? AND id <> ?", item.OrgID, item.GatewayID, item.ID).
				Update("is_default", false).Error; err != nil {
				return err
			}
		}
		return tx.Select("*").Save(item).Error
	})
}

func (r *ProxyGatewayRepository) DeleteSecurityPolicy(orgID, id uint) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var policy models.ProxyGatewaySecurityPolicy
		if err := tx.First(&policy, "org_id = ? AND id = ?", orgID, id).Error; err != nil {
			return err
		}
		if policy.IsDefault {
			return errors.New("default security policy cannot be deleted")
		}
		if err := ensureSecurityPolicyNotReferenced(tx, orgID, id); err != nil {
			return err
		}
		return tx.Where("org_id = ? AND id = ?", orgID, id).Delete(&models.ProxyGatewaySecurityPolicy{}).Error
	})
}

func (r *ProxyGatewayRepository) GetDefaultSecurityPolicy(orgID, gatewayID uint) (*models.ProxyGatewaySecurityPolicy, error) {
	var item models.ProxyGatewaySecurityPolicy
	err := r.db.Where("org_id = ? AND gateway_id = ? AND is_default = ?", orgID, gatewayID, true).Order("id ASC").First(&item).Error
	if errors.Is(err, gorm.ErrRecordNotFound) && gatewayID != 0 {
		err = r.db.Where("org_id = ? AND gateway_id = ? AND is_default = ?", orgID, 0, true).Order("id ASC").First(&item).Error
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		item = *DefaultProxyGatewaySecurityPolicy(orgID, gatewayID)
		return &item, nil
	}
	return &item, err
}

func (r *ProxyGatewayRepository) ListDNSPolicies(orgID uint, gatewayID *uint) ([]models.ProxyGatewayDNSPolicy, error) {
	var items []models.ProxyGatewayDNSPolicy
	query := r.db.Where("org_id = ?", orgID)
	if gatewayID != nil {
		query = query.Where("gateway_id = ?", *gatewayID)
	}
	err := query.Order("is_default DESC, updated_at DESC").Find(&items).Error
	return items, err
}

func (r *ProxyGatewayRepository) GetDNSPolicy(orgID, id uint) (*models.ProxyGatewayDNSPolicy, error) {
	var item models.ProxyGatewayDNSPolicy
	err := r.db.First(&item, "org_id = ? AND id = ?", orgID, id).Error
	return &item, err
}

func (r *ProxyGatewayRepository) SaveDNSPolicy(item *models.ProxyGatewayDNSPolicy) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if item.IsDefault {
			if err := tx.Model(&models.ProxyGatewayDNSPolicy{}).
				Where("org_id = ? AND gateway_id = ? AND id <> ?", item.OrgID, item.GatewayID, item.ID).
				Update("is_default", false).Error; err != nil {
				return err
			}
		}
		return tx.Select("*").Save(item).Error
	})
}

func (r *ProxyGatewayRepository) DeleteDNSPolicy(orgID, id uint) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var policy models.ProxyGatewayDNSPolicy
		if err := tx.First(&policy, "org_id = ? AND id = ?", orgID, id).Error; err != nil {
			return err
		}
		if policy.IsDefault {
			return errors.New("default DNS policy cannot be deleted")
		}
		if err := ensureDNSPolicyNotReferenced(tx, orgID, id); err != nil {
			return err
		}
		return tx.Where("org_id = ? AND id = ?", orgID, id).Delete(&models.ProxyGatewayDNSPolicy{}).Error
	})
}

func (r *ProxyGatewayRepository) GetDefaultDNSPolicy(orgID, gatewayID uint) (*models.ProxyGatewayDNSPolicy, error) {
	var item models.ProxyGatewayDNSPolicy
	err := r.db.Where("org_id = ? AND gateway_id = ? AND is_default = ?", orgID, gatewayID, true).Order("id ASC").First(&item).Error
	if errors.Is(err, gorm.ErrRecordNotFound) && gatewayID != 0 {
		err = r.db.Where("org_id = ? AND gateway_id = ? AND is_default = ?", orgID, 0, true).Order("id ASC").First(&item).Error
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		item = *DefaultProxyGatewayDNSPolicy(orgID, gatewayID)
		return &item, nil
	}
	return &item, err
}

func ensureSecurityPolicyNotReferenced(tx *gorm.DB, orgID, id uint) error {
	checks := []struct {
		name  string
		model interface{}
	}{
		{name: "proxy gateway listener", model: &models.ProxyGatewayListener{}},
		{name: "proxy gateway account", model: &models.ProxyGatewayAccount{}},
		{name: "proxy gateway route strategy", model: &models.ProxyGatewayRouteStrategy{}},
	}
	for _, check := range checks {
		var count int64
		if err := tx.Model(check.model).Where("org_id = ? AND security_policy_id = ?", orgID, id).Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			return errors.New("security policy is still referenced by " + check.name)
		}
	}
	return nil
}

func ensureDNSPolicyNotReferenced(tx *gorm.DB, orgID, id uint) error {
	checks := []struct {
		name  string
		model interface{}
	}{
		{name: "proxy gateway listener", model: &models.ProxyGatewayListener{}},
		{name: "proxy gateway account", model: &models.ProxyGatewayAccount{}},
		{name: "proxy gateway route strategy", model: &models.ProxyGatewayRouteStrategy{}},
	}
	for _, check := range checks {
		var count int64
		if err := tx.Model(check.model).Where("org_id = ? AND dns_policy_id = ?", orgID, id).Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			return errors.New("DNS policy is still referenced by " + check.name)
		}
	}
	return nil
}

func (r *ProxyGatewayRepository) CreateAccessLog(logEntry *models.ProxyGatewayAccessLog) error {
	return r.db.Create(logEntry).Error
}

func (r *ProxyGatewayRepository) ListAccessLogs(orgID uint, filter ProxyGatewayLogFilter) ([]models.ProxyGatewayAccessLog, int64, error) {
	if filter.Page < 1 {
		filter.Page = 1
	}
	if filter.Limit < 1 {
		filter.Limit = 50
	}
	if filter.Limit > 500 {
		filter.Limit = 500
	}
	query := r.db.Model(&models.ProxyGatewayAccessLog{}).Where("proxy_gateway_access_logs.org_id = ?", orgID)
	if filter.AccountID != nil {
		query = query.Where("proxy_gateway_access_logs.account_id = ?", *filter.AccountID)
	}
	if filter.AccountName != "" {
		term := "%" + escapeSQLLike(strings.TrimSpace(filter.AccountName)) + "%"
		query = query.
			Joins("LEFT JOIN proxy_gateway_accounts AS log_account ON log_account.id = proxy_gateway_access_logs.account_id AND log_account.org_id = proxy_gateway_access_logs.org_id").
			Where("(LOWER(log_account.name) LIKE LOWER(?) ESCAPE '!' OR LOWER(proxy_gateway_access_logs.username) LIKE LOWER(?) ESCAPE '!')", term, term)
	}
	if filter.ListenerID != nil {
		query = query.Where("proxy_gateway_access_logs.listener_id = ?", *filter.ListenerID)
	}
	if filter.SourceIP != "" {
		query = query.Where("proxy_gateway_access_logs.client_ip = ?", strings.TrimSpace(filter.SourceIP))
	}
	if filter.Status != "" {
		query = query.Where("proxy_gateway_access_logs.status = ?", filter.Status)
	}
	if filter.Protocol != "" {
		query = query.Where("proxy_gateway_access_logs.protocol = ?", filter.Protocol)
	}
	if filter.StartTime != nil {
		query = query.Where("proxy_gateway_access_logs.created_at >= ?", *filter.StartTime)
	}
	if filter.EndTime != nil {
		query = query.Where("proxy_gateway_access_logs.created_at <= ?", *filter.EndTime)
	}
	if filter.Search != "" {
		term := "%" + strings.TrimSpace(filter.Search) + "%"
		query = query.Where("(proxy_gateway_access_logs.username LIKE ? OR proxy_gateway_access_logs.client_ip LIKE ? OR proxy_gateway_access_logs.target_host LIKE ? OR proxy_gateway_access_logs.deny_reason LIKE ?)", term, term, term, term)
	}
	if filter.Target != "" {
		target := strings.TrimSpace(filter.Target)
		if filter.TargetMatch == "regex" {
			compiled, err := regexp.Compile("(?i:" + target + ")")
			if err != nil {
				return nil, 0, err
			}
			if r.db.Dialector.Name() == "sqlite" {
				return listSQLiteRegexAccessLogs(query, compiled, filter.Page, filter.Limit)
			}
			if r.db.Dialector.Name() == "postgres" {
				query = query.Where("proxy_gateway_access_logs.target_host ~* ?", target)
			} else {
				query = query.Where("LOWER(proxy_gateway_access_logs.target_host) REGEXP LOWER(?)", target)
			}
		} else {
			query = query.Where("LOWER(proxy_gateway_access_logs.target_host) LIKE LOWER(?) ESCAPE '!'", wildcardSQLLike(target))
		}
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var logs []models.ProxyGatewayAccessLog
	err := query.Order("proxy_gateway_access_logs.created_at DESC").Limit(filter.Limit).Offset((filter.Page - 1) * filter.Limit).Find(&logs).Error
	return logs, total, err
}

func escapeSQLLike(value string) string {
	var builder strings.Builder
	for _, char := range value {
		if char == '!' || char == '%' || char == '_' {
			builder.WriteRune('!')
		}
		builder.WriteRune(char)
	}
	return builder.String()
}

func wildcardSQLLike(value string) string {
	var builder strings.Builder
	for _, char := range value {
		switch char {
		case '*':
			builder.WriteRune('%')
		case '?':
			builder.WriteRune('_')
		case '!', '%', '_':
			builder.WriteRune('!')
			builder.WriteRune(char)
		default:
			builder.WriteRune(char)
		}
	}
	return builder.String()
}

// SQLite has no REGEXP function by default. Keep development and test databases
// feature-compatible by applying the validated RE2 expression after all other
// indexed filters; production PostgreSQL/MySQL databases execute it in SQL.
func listSQLiteRegexAccessLogs(query *gorm.DB, expression *regexp.Regexp, page, limit int) ([]models.ProxyGatewayAccessLog, int64, error) {
	var candidates []models.ProxyGatewayAccessLog
	if err := query.Order("proxy_gateway_access_logs.created_at DESC").Find(&candidates).Error; err != nil {
		return nil, 0, err
	}
	matched := make([]models.ProxyGatewayAccessLog, 0, len(candidates))
	for _, item := range candidates {
		if expression.MatchString(item.TargetHost) {
			matched = append(matched, item)
		}
	}
	total := int64(len(matched))
	start := (page - 1) * limit
	if start >= len(matched) {
		return []models.ProxyGatewayAccessLog{}, total, nil
	}
	end := start + limit
	if end > len(matched) {
		end = len(matched)
	}
	return matched[start:end], total, nil
}

func (r *ProxyGatewayRepository) CreateAuditLog(logEntry *models.ProxyGatewayAuditLog) error {
	return r.db.Create(logEntry).Error
}

func (r *ProxyGatewayRepository) ListAuditLogs(orgID uint, limit int) ([]models.ProxyGatewayAuditLog, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	var logs []models.ProxyGatewayAuditLog
	err := r.db.Where("org_id = ?", orgID).Order("created_at DESC").Limit(limit).Find(&logs).Error
	return logs, err
}
