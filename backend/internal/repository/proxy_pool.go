package repository

import (
	"errors"
	"mailman/internal/models"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type ProxyPoolRepository struct {
	db *gorm.DB
}

type ProxyPoolFilter struct {
	Search      string
	Status      string
	Type        string
	GroupIDs    []uint
	TagIDs      []uint
	TagMode     string
	UsageScope  string
	ExitIP      string
	Page        int
	Limit       int
	SortBy      string
	SortOrder   string
	OnlyHealthy bool
}

type ProxyTrafficSummary struct {
	TrafficBytesIn  int64 `gorm:"column:traffic_bytes_in" json:"trafficBytesIn"`
	TrafficBytesOut int64 `gorm:"column:traffic_bytes_out" json:"trafficBytesOut"`
}

type ProxyDeleteReplacement struct {
	Mode          string
	ProxyID       *uint
	GroupIDs      []uint
	TagIDs        []uint
	TagMode       string
	FallbackProxy string
}

func NewProxyPoolRepository(db *gorm.DB) *ProxyPoolRepository {
	return &ProxyPoolRepository{db: db}
}

func (r *ProxyPoolRepository) GetDB() *gorm.DB {
	return r.db
}

func (r *ProxyPoolRepository) Transaction(fn func(*ProxyPoolRepository) error) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		return fn(NewProxyPoolRepository(tx))
	})
}

func (r *ProxyPoolRepository) Create(proxyItem *models.ProxyPoolItem) error {
	return r.db.Create(proxyItem).Error
}

func (r *ProxyPoolRepository) BatchCreate(proxyItems []*models.ProxyPoolItem) error {
	if len(proxyItems) == 0 {
		return nil
	}
	return r.db.CreateInBatches(&proxyItems, 200).Error
}

func (r *ProxyPoolRepository) BatchCreateWithTags(proxyItems []*models.ProxyPoolItem, tagIDs []uint) error {
	if len(proxyItems) == 0 {
		return nil
	}
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.CreateInBatches(&proxyItems, 200).Error; err != nil {
			return err
		}
		if len(tagIDs) == 0 {
			return nil
		}
		links := make([]models.ProxyPoolItemTag, 0, len(proxyItems)*len(tagIDs))
		for _, item := range proxyItems {
			for _, tagID := range tagIDs {
				links = append(links, models.ProxyPoolItemTag{ProxyID: item.ID, TagID: tagID})
			}
		}
		return tx.CreateInBatches(&links, 500).Error
	})
}

// FindDuplicatesForImport loads duplicate candidates in bounded query chunks,
// avoiding one database round trip per imported proxy.
func (r *ProxyPoolRepository) FindDuplicatesForImport(orgID uint, proxyItems []models.ProxyPoolItem) ([]models.ProxyPoolItem, error) {
	hostSet := make(map[string]struct{}, len(proxyItems))
	for _, item := range proxyItems {
		hostSet[item.Host] = struct{}{}
	}
	hosts := make([]string, 0, len(hostSet))
	for host := range hostSet {
		hosts = append(hosts, host)
	}
	result := make([]models.ProxyPoolItem, 0)
	for start := 0; start < len(hosts); start += 400 {
		end := start + 400
		if end > len(hosts) {
			end = len(hosts)
		}
		var batch []models.ProxyPoolItem
		if err := r.db.Where("org_id = ? AND host IN ?", orgID, hosts[start:end]).Find(&batch).Error; err != nil {
			return nil, err
		}
		result = append(result, batch...)
	}
	return result, nil
}

func (r *ProxyPoolRepository) Update(proxyItem *models.ProxyPoolItem) error {
	return r.db.Save(proxyItem).Error
}

func (r *ProxyPoolRepository) FindDuplicate(orgID uint, proxyItem models.ProxyPoolItem) (*models.ProxyPoolItem, error) {
	var existing models.ProxyPoolItem
	err := r.db.
		Where("org_id = ? AND type = ? AND host = ? AND port = ? AND username = ?", orgID, models.NormalizeProxyType(proxyItem.Type), proxyItem.Host, proxyItem.Port, proxyItem.Username).
		First(&existing).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &existing, nil
}

func (r *ProxyPoolRepository) GetByID(orgID, id uint) (*models.ProxyPoolItem, error) {
	var proxyItem models.ProxyPoolItem
	query := r.db.Preload("Group").Preload("Tags").First(&proxyItem, "id = ? AND org_id = ?", id, orgID)
	if err := query.Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("proxy not found")
		}
		return nil, err
	}
	return &proxyItem, nil
}

func (r *ProxyPoolRepository) List(orgID uint, filter ProxyPoolFilter) ([]models.ProxyPoolItem, int64, error) {
	var proxies []models.ProxyPoolItem
	var total int64

	filter = NormalizeProxyPoolFilter(filter)

	query := r.applyProxyFilter(r.db.Model(&models.ProxyPoolItem{}), orgID, filter)
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	order := "created_at DESC"
	switch filter.SortBy {
	case "host":
		order = "host"
	case "status":
		order = "status"
	case "lastCheckAt", "last_check_at":
		order = "last_check_at"
	case "latency", "checkLatencyMs", "check_latency_ms":
		order = "check_latency_ms"
	}
	if strings.ToLower(filter.SortOrder) == "asc" {
		order += " ASC"
	} else {
		if !strings.HasSuffix(order, "DESC") {
			order += " DESC"
		}
	}

	err := r.applyProxyFilter(r.db.Model(&models.ProxyPoolItem{}), orgID, filter).
		Preload("Group").
		Preload("Tags").
		Order(order).
		Limit(filter.Limit).
		Offset((filter.Page - 1) * filter.Limit).
		Find(&proxies).Error
	return proxies, total, err
}

func NormalizeProxyPoolFilter(filter ProxyPoolFilter) ProxyPoolFilter {
	if filter.Page < 1 {
		filter.Page = 1
	}
	if filter.Limit < 1 {
		filter.Limit = 20
	}
	maxInt := int(^uint(0) >> 1)
	if filter.Page > 1 && filter.Page-1 > maxInt/filter.Limit {
		filter.Page = maxInt/filter.Limit + 1
	}
	return filter
}

func (r *ProxyPoolRepository) ListIDs(orgID uint, filter ProxyPoolFilter) ([]uint, error) {
	var ids []uint
	query := r.applyProxyFilter(r.db.Model(&models.ProxyPoolItem{}), orgID, filter).
		Order("id ASC")
	if err := query.Pluck("id", &ids).Error; err != nil {
		return nil, err
	}
	return ids, nil
}

// SumTraffic returns totals for every proxy matched by the filter, independent
// of list pagination. Traffic is counted from the gateway perspective:
// bytes-in comes from downstream clients and bytes-out returns to them.
func (r *ProxyPoolRepository) SumTraffic(orgID uint, filter ProxyPoolFilter) (ProxyTrafficSummary, error) {
	var summary ProxyTrafficSummary
	err := r.applyProxyFilter(r.db.Model(&models.ProxyPoolItem{}), orgID, filter).
		Select("COALESCE(SUM(traffic_bytes_in), 0) AS traffic_bytes_in, COALESCE(SUM(traffic_bytes_out), 0) AS traffic_bytes_out").
		Scan(&summary).Error
	return summary, err
}

// AddTraffic atomically persists one completed gateway session without
// rewriting proxy configuration fields or their UpdatedAt timestamp.
func (r *ProxyPoolRepository) AddTraffic(orgID, proxyID uint, bytesIn, bytesOut int64) error {
	if bytesIn < 0 || bytesOut < 0 {
		return errors.New("proxy traffic counters must not be negative")
	}
	if proxyID == 0 || bytesIn == 0 && bytesOut == 0 {
		return nil
	}
	return r.db.Model(&models.ProxyPoolItem{}).
		Where("org_id = ? AND id = ?", orgID, proxyID).
		UpdateColumns(map[string]interface{}{
			"traffic_bytes_in":  gorm.Expr("traffic_bytes_in + ?", bytesIn),
			"traffic_bytes_out": gorm.Expr("traffic_bytes_out + ?", bytesOut),
		}).Error
}

func (r *ProxyPoolRepository) applyProxyFilter(query *gorm.DB, orgID uint, filter ProxyPoolFilter) *gorm.DB {
	query = query.Where("org_id = ?", orgID)
	if filter.Search != "" {
		term := "%" + filter.Search + "%"
		query = query.Where("(host LIKE ? OR remark LIKE ? OR exit_ip LIKE ? OR username LIKE ?)", term, term, term, term)
	}
	if filter.Status != "" {
		query = query.Where("status = ?", filter.Status)
	}
	if filter.Type != "" {
		query = query.Where("type = ?", strings.ToLower(filter.Type))
	}
	if filter.UsageScope != "" {
		query = query.Where("usage_scope = ?", filter.UsageScope)
	}
	if filter.ExitIP != "" {
		query = query.Where("exit_ip = ?", filter.ExitIP)
	}
	if filter.OnlyHealthy {
		query = query.Where("status = ?", models.ProxyStatusAvailable)
	}
	if len(filter.GroupIDs) > 0 {
		query = query.Where("group_id IN ?", filter.GroupIDs)
	}
	if len(filter.TagIDs) > 0 {
		sub := r.db.Model(&models.ProxyPoolItemTag{}).Select("proxy_id").Where("tag_id IN ?", filter.TagIDs)
		if strings.ToLower(filter.TagMode) == "and" {
			sub = sub.Group("proxy_id").Having("COUNT(DISTINCT tag_id) = ?", len(filter.TagIDs))
		}
		query = query.Where("id IN (?)", sub)
	}
	return query
}

func (r *ProxyPoolRepository) SetProxyTags(proxyID uint, tagIDs []uint) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("proxy_id = ?", proxyID).Delete(&models.ProxyPoolItemTag{}).Error; err != nil {
			return err
		}
		for _, tagID := range tagIDs {
			if err := tx.Create(&models.ProxyPoolItemTag{ProxyID: proxyID, TagID: tagID}).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func (r *ProxyPoolRepository) DeleteByIDs(orgID uint, ids []uint, replacement ProxyDeleteReplacement) (int64, error) {
	ids = uniqueUintIDs(ids)
	if len(ids) == 0 {
		return 0, nil
	}

	var affectedAccounts int64
	err := r.db.Transaction(func(tx *gorm.DB) error {
		var count int64
		if err := tx.Model(&models.EmailAccount{}).
			Where("org_id = ? AND (proxy_id IN ? OR proxy_fallback_proxy_id IN ?)", orgID, ids, ids).
			Count(&count).Error; err != nil {
			return err
		}
		affectedAccounts = count

		updates := map[string]interface{}{}
		fallbackUpdates := map[string]interface{}{}
		switch replacement.Mode {
		case "proxy":
			if replacement.ProxyID == nil {
				return errors.New("replacement proxy is required")
			}
			if uintInSlice(*replacement.ProxyID, ids) {
				return errors.New("replacement proxy cannot be one of the proxies being deleted")
			}
			replacementProxy := models.ProxyPoolItem{}
			if err := tx.First(&replacementProxy, "id = ? AND org_id = ?", *replacement.ProxyID, orgID).Error; err != nil {
				return err
			}
			if replacementProxy.Status != models.ProxyStatusAvailable {
				return errors.New("replacement proxy must be available")
			}
			updates["proxy_id"] = replacementProxy.ID
			updates["proxy"] = replacementProxy.ProxyURL()
			updates["proxy_mode"] = models.ProxyAccountModeSelected
			fallbackUpdates["proxy_fallback_proxy_id"] = replacementProxy.ID
			fallbackUpdates["proxy_fallback_proxy"] = ""
		case "auto":
			updates["proxy_id"] = nil
			updates["proxy"] = ""
			updates["proxy_mode"] = models.ProxyAccountModeAuto
			updates["proxy_fallback_mode"] = models.ProxyFallbackAutoSelect
			updates["proxy_match_group_ids"] = models.UintSlice(replacement.GroupIDs)
			updates["proxy_match_tag_ids"] = models.UintSlice(replacement.TagIDs)
			updates["proxy_match_tag_mode"] = models.NormalizeProxyTagFilterMode(models.ProxyTagFilterMode(replacement.TagMode))
			fallbackUpdates["proxy_fallback_proxy_id"] = nil
			fallbackUpdates["proxy_fallback_proxy"] = ""
			fallbackUpdates["proxy_fallback_mode"] = models.ProxyFallbackAutoSelect
		case "manual":
			if strings.TrimSpace(replacement.FallbackProxy) == "" {
				return errors.New("manual replacement proxy is required")
			}
			updates["proxy_id"] = nil
			updates["proxy"] = replacement.FallbackProxy
			updates["proxy_mode"] = models.ProxyAccountModeManual
			fallbackUpdates["proxy_fallback_proxy_id"] = nil
			fallbackUpdates["proxy_fallback_proxy"] = replacement.FallbackProxy
		default:
			updates["proxy_id"] = nil
			updates["proxy"] = ""
			updates["proxy_mode"] = models.ProxyAccountModeManual
			fallbackUpdates["proxy_fallback_proxy_id"] = nil
			fallbackUpdates["proxy_fallback_proxy"] = ""
		}

		if len(updates) > 0 {
			if err := tx.Model(&models.EmailAccount{}).
				Where("org_id = ? AND proxy_id IN ?", orgID, ids).
				Updates(updates).Error; err != nil {
				return err
			}
		}
		if len(fallbackUpdates) > 0 {
			if err := tx.Model(&models.EmailAccount{}).
				Where("org_id = ? AND proxy_fallback_proxy_id IN ?", orgID, ids).
				Updates(fallbackUpdates).Error; err != nil {
				return err
			}
		}

		if err := tx.Where("proxy_id IN ?", ids).Delete(&models.ProxyPoolItemTag{}).Error; err != nil {
			return err
		}
		return tx.Where("org_id = ? AND id IN ?", orgID, ids).Delete(&models.ProxyPoolItem{}).Error
	})
	return affectedAccounts, err
}

func (r *ProxyPoolRepository) PickAvailable(orgID uint, groupIDs, tagIDs []uint, tagMode string, excludeIDs []uint) (*models.ProxyPoolItem, error) {
	filter := ProxyPoolFilter{
		Status:   string(models.ProxyStatusAvailable),
		GroupIDs: groupIDs,
		TagIDs:   tagIDs,
		TagMode:  tagMode,
		Limit:    1,
	}
	query := r.applyProxyFilter(r.db.Model(&models.ProxyPoolItem{}), orgID, filter)
	if len(excludeIDs) > 0 {
		query = query.Where("id NOT IN ?", excludeIDs)
	}

	var proxyItem models.ProxyPoolItem
	randomOrder := "RANDOM()"
	if r.db.Dialector.Name() == "mysql" {
		randomOrder = "RAND()"
	}
	if err := query.Preload("Group").Preload("Tags").Order(randomOrder).First(&proxyItem).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("no available proxy matched")
		}
		return nil, err
	}
	return &proxyItem, nil
}

func (r *ProxyPoolRepository) UpdateCheckResult(proxyID uint, updates map[string]interface{}) error {
	return r.db.Model(&models.ProxyPoolItem{}).Where("id = ?", proxyID).Updates(updates).Error
}

func (r *ProxyPoolRepository) EnsureCheckChannels(defaults []models.ProxyCheckChannel) error {
	if len(defaults) == 0 {
		return nil
	}
	return r.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "org_id"}, {Name: "key"}},
		DoNothing: true,
	}).Create(&defaults).Error
}

func (r *ProxyPoolRepository) ListCheckChannels(orgID uint, includeDisabled bool) ([]models.ProxyCheckChannel, error) {
	var channels []models.ProxyCheckChannel
	query := r.notDeleted(r.db.Unscoped().Where("org_id = ?", orgID))
	if !includeDisabled {
		query = query.Where("enabled = ?", true)
	}
	err := query.Order("sort_order ASC, name ASC").Find(&channels).Error
	for i := range channels {
		channels[i].HasCredential = strings.TrimSpace(channels[i].AuthValue) != ""
	}
	return channels, err
}

func (r *ProxyPoolRepository) GetCheckChannelByKey(orgID uint, key string) (*models.ProxyCheckChannel, error) {
	var channel models.ProxyCheckChannel
	err := r.notDeleted(r.db.Unscoped().Where("org_id = ? AND key = ?", orgID, key)).First(&channel).Error
	if err != nil {
		return nil, err
	}
	channel.HasCredential = strings.TrimSpace(channel.AuthValue) != ""
	return &channel, nil
}

func (r *ProxyPoolRepository) GetCheckChannelByID(orgID, id uint) (*models.ProxyCheckChannel, error) {
	var channel models.ProxyCheckChannel
	err := r.notDeleted(r.db.Unscoped().Where("org_id = ? AND id = ?", orgID, id)).First(&channel).Error
	if err != nil {
		return nil, err
	}
	channel.HasCredential = strings.TrimSpace(channel.AuthValue) != ""
	return &channel, nil
}

func (r *ProxyPoolRepository) CreateCheckChannel(channel *models.ProxyCheckChannel) error {
	return r.db.Create(channel).Error
}

func (r *ProxyPoolRepository) UpdateCheckChannel(channel *models.ProxyCheckChannel) error {
	return r.db.Select("name", "provider", "description", "mode", "url_template", "method", "response_format", "ip_field", "country_field", "region_field", "city_field", "isp_field", "status_field", "failure_value", "message_field", "headers", "auth_type", "auth_name", "auth_value", "enabled", "supports_ipv4", "supports_ipv6", "timeout_seconds", "sort_order", "updated_at").Save(channel).Error
}

func (r *ProxyPoolRepository) DeleteCheckChannel(orgID, id uint) error {
	channel, err := r.GetCheckChannelByID(orgID, id)
	if err != nil {
		return err
	}
	if channel.BuiltIn {
		return errors.New("built-in check channels cannot be deleted; disable it instead")
	}
	return r.db.Delete(channel).Error
}

func (r *ProxyPoolRepository) notDeleted(query *gorm.DB) *gorm.DB {
	if r.db.Dialector.Name() == "mysql" {
		return query.Where("(deleted_at IS NULL OR deleted_at = ? OR deleted_at = ?)", "0000-00-00 00:00:00", "0001-01-01 00:00:00")
	}
	return query.Where("(deleted_at IS NULL OR deleted_at = ?)", time.Time{})
}

func (r *ProxyPoolRepository) ListGroups(orgID uint) ([]models.ProxyGroup, error) {
	var groups []models.ProxyGroup
	err := r.notDeleted(r.db.Unscoped().Where("org_id = ?", orgID)).Order("sort_order ASC, name ASC").Find(&groups).Error
	return groups, err
}

func (r *ProxyPoolRepository) CreateGroup(group *models.ProxyGroup) error {
	return r.db.Create(group).Error
}

func (r *ProxyPoolRepository) UpdateGroup(group *models.ProxyGroup) error {
	return r.db.Save(group).Error
}

func (r *ProxyPoolRepository) DeleteGroup(orgID, id uint) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&models.ProxyPoolItem{}).Where("org_id = ? AND group_id = ?", orgID, id).Update("group_id", nil).Error; err != nil {
			return err
		}
		if err := removeAccountMatchID(tx, orgID, "group", id); err != nil {
			return err
		}
		return tx.Unscoped().Where("org_id = ? AND id = ?", orgID, id).Delete(&models.ProxyGroup{}).Error
	})
}

func (r *ProxyPoolRepository) GetGroupByID(orgID, id uint) (*models.ProxyGroup, error) {
	var group models.ProxyGroup
	if err := r.notDeleted(r.db.Unscoped().Where("org_id = ? AND id = ?", orgID, id)).First(&group).Error; err != nil {
		return nil, err
	}
	return &group, nil
}

func (r *ProxyPoolRepository) ListTags(orgID uint) ([]models.ProxyTag, error) {
	var tags []models.ProxyTag
	err := r.notDeleted(r.db.Unscoped().Where("org_id = ?", orgID)).Order("sort_order ASC, name ASC").Find(&tags).Error
	return tags, err
}

func (r *ProxyPoolRepository) CreateTag(tag *models.ProxyTag) error {
	return r.db.Create(tag).Error
}

func (r *ProxyPoolRepository) UpdateTag(tag *models.ProxyTag) error {
	return r.db.Save(tag).Error
}

func (r *ProxyPoolRepository) DeleteTag(orgID, id uint) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("tag_id = ?", id).Delete(&models.ProxyPoolItemTag{}).Error; err != nil {
			return err
		}
		if err := removeAccountMatchID(tx, orgID, "tag", id); err != nil {
			return err
		}
		return tx.Unscoped().Where("org_id = ? AND id = ?", orgID, id).Delete(&models.ProxyTag{}).Error
	})
}

func (r *ProxyPoolRepository) GetTagByID(orgID, id uint) (*models.ProxyTag, error) {
	var tag models.ProxyTag
	if err := r.notDeleted(r.db.Unscoped().Where("org_id = ? AND id = ?", orgID, id)).First(&tag).Error; err != nil {
		return nil, err
	}
	return &tag, nil
}

func removeAccountMatchID(tx *gorm.DB, orgID uint, kind string, id uint) error {
	var accounts []models.EmailAccount
	if err := tx.Where("org_id = ?", orgID).Find(&accounts).Error; err != nil {
		return err
	}
	for i := range accounts {
		account := accounts[i]
		updates := map[string]interface{}{}
		switch kind {
		case "group":
			next, changed := removeUint(account.ProxyMatchGroupIDs, id)
			if changed {
				updates["proxy_match_group_ids"] = next
			}
		case "tag":
			next, changed := removeUint(account.ProxyMatchTagIDs, id)
			if changed {
				updates["proxy_match_tag_ids"] = next
			}
		}
		if len(updates) == 0 {
			continue
		}
		if err := tx.Model(&models.EmailAccount{}).Where("id = ? AND org_id = ?", account.ID, orgID).Updates(updates).Error; err != nil {
			return err
		}
	}
	return nil
}

func removeUint(values models.UintSlice, target uint) (models.UintSlice, bool) {
	next := make(models.UintSlice, 0, len(values))
	changed := false
	for _, value := range values {
		if value == target {
			changed = true
			continue
		}
		next = append(next, value)
	}
	return next, changed
}

func uniqueUintIDs(values []uint) []uint {
	if len(values) == 0 {
		return values
	}
	seen := make(map[uint]struct{}, len(values))
	next := make([]uint, 0, len(values))
	for _, value := range values {
		if value == 0 {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		next = append(next, value)
	}
	return next
}

func uintInSlice(target uint, values []uint) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
