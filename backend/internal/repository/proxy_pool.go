package repository

import (
	"errors"
	"mailman/internal/models"
	"strings"
	"time"

	"gorm.io/gorm"
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

func (r *ProxyPoolRepository) Create(proxyItem *models.ProxyPoolItem) error {
	return r.db.Create(proxyItem).Error
}

func (r *ProxyPoolRepository) BatchCreate(proxyItems []*models.ProxyPoolItem) error {
	if len(proxyItems) == 0 {
		return nil
	}
	return r.db.Create(&proxyItems).Error
}

func (r *ProxyPoolRepository) Update(proxyItem *models.ProxyPoolItem) error {
	return r.db.Save(proxyItem).Error
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

	if filter.Page < 1 {
		filter.Page = 1
	}
	if filter.Limit < 1 {
		filter.Limit = 20
	}
	if filter.Limit > 500 {
		filter.Limit = 500
	}

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
	if len(ids) == 0 {
		return 0, nil
	}

	var affectedAccounts int64
	err := r.db.Transaction(func(tx *gorm.DB) error {
		var count int64
		if err := tx.Model(&models.EmailAccount{}).
			Where("org_id = ? AND proxy_id IN ?", orgID, ids).
			Count(&count).Error; err != nil {
			return err
		}
		affectedAccounts = count

		updates := map[string]interface{}{}
		switch replacement.Mode {
		case "proxy":
			if replacement.ProxyID == nil {
				return errors.New("replacement proxy is required")
			}
			replacementProxy := models.ProxyPoolItem{}
			if err := tx.First(&replacementProxy, "id = ? AND org_id = ?", *replacement.ProxyID, orgID).Error; err != nil {
				return err
			}
			updates["proxy_id"] = replacementProxy.ID
			updates["proxy"] = replacementProxy.ProxyURL()
			updates["proxy_mode"] = models.ProxyAccountModeSelected
		case "auto":
			updates["proxy_id"] = nil
			updates["proxy"] = ""
			updates["proxy_mode"] = models.ProxyAccountModeAuto
			updates["proxy_fallback_mode"] = models.ProxyFallbackAutoSelect
			updates["proxy_match_group_ids"] = models.UintSlice(replacement.GroupIDs)
			updates["proxy_match_tag_ids"] = models.UintSlice(replacement.TagIDs)
			updates["proxy_match_tag_mode"] = models.NormalizeProxyTagFilterMode(models.ProxyTagFilterMode(replacement.TagMode))
		case "manual":
			updates["proxy_id"] = nil
			updates["proxy"] = replacement.FallbackProxy
			updates["proxy_mode"] = models.ProxyAccountModeManual
		default:
			updates["proxy_id"] = nil
			updates["proxy"] = ""
			updates["proxy_mode"] = models.ProxyAccountModeManual
		}

		if len(updates) > 0 {
			if err := tx.Model(&models.EmailAccount{}).
				Where("org_id = ? AND proxy_id IN ?", orgID, ids).
				Updates(updates).Error; err != nil {
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
