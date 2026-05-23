package repository

import (
	"errors"
	"mailman/internal/models"

	"gorm.io/gorm"
)

// TagRepository handles database operations for Tags and TagGroups
type TagRepository struct {
	db *gorm.DB
}

// NewTagRepository creates a new TagRepository
func NewTagRepository(db *gorm.DB) *TagRepository {
	return &TagRepository{db: db}
}

// GetDB returns the database connection
func (r *TagRepository) GetDB() *gorm.DB {
	return r.db
}

// ======================== TagGroup CRUD ========================

// CreateTagGroup creates a new tag group
func (r *TagRepository) CreateTagGroup(group *models.TagGroup) error {
	return r.db.Create(group).Error
}

// GetTagGroupByID retrieves a tag group by ID with its tags
func (r *TagRepository) GetTagGroupByID(id uint) (*models.TagGroup, error) {
	var group models.TagGroup
	err := r.db.Preload("Tags", func(db *gorm.DB) *gorm.DB {
		return db.Order("sort_order ASC, id ASC")
	}).First(&group, id).Error
	if err != nil {
		return nil, err
	}
	return &group, nil
}

// GetTagGroupByName retrieves a tag group by name
func (r *TagRepository) GetTagGroupByName(name string) (*models.TagGroup, error) {
	var group models.TagGroup
	err := r.db.Where("name = ?", name).First(&group).Error
	if err != nil {
		return nil, err
	}
	return &group, nil
}

// GetAllTagGroups retrieves all tag groups with their tags
func (r *TagRepository) GetAllTagGroups() ([]models.TagGroup, error) {
	var groups []models.TagGroup
	err := r.db.Preload("Tags", func(db *gorm.DB) *gorm.DB {
		return db.Order("sort_order ASC, id ASC")
	}).Order("sort_order ASC, id ASC").Find(&groups).Error
	if err != nil {
		return nil, err
	}
	return groups, nil
}

// UpdateTagGroup updates a tag group
func (r *TagRepository) UpdateTagGroup(group *models.TagGroup) error {
	return r.db.Save(group).Error
}

// DeleteTagGroup soft deletes a tag group and its tags
func (r *TagRepository) DeleteTagGroup(id uint) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		// Delete all tags in the group
		if err := tx.Where("group_id = ?", id).Delete(&models.Tag{}).Error; err != nil {
			return err
		}
		// Delete the group
		return tx.Delete(&models.TagGroup{}, id).Error
	})
}

// ======================== Tag CRUD ========================

// CreateTag creates a new tag
func (r *TagRepository) CreateTag(tag *models.Tag) error {
	return r.db.Create(tag).Error
}

// GetTagByID retrieves a tag by ID with its group
func (r *TagRepository) GetTagByID(id uint) (*models.Tag, error) {
	var tag models.Tag
	err := r.db.Preload("Group").First(&tag, id).Error
	if err != nil {
		return nil, err
	}
	return &tag, nil
}

// GetTagsByGroupID retrieves all tags in a group
func (r *TagRepository) GetTagsByGroupID(groupID uint) ([]models.Tag, error) {
	var tags []models.Tag
	err := r.db.Where("group_id = ?", groupID).Order("sort_order ASC, id ASC").Find(&tags).Error
	if err != nil {
		return nil, err
	}
	return tags, nil
}

// GetTagByNameInGroup retrieves a tag by name within a group
func (r *TagRepository) GetTagByNameInGroup(groupID uint, name string) (*models.Tag, error) {
	var tag models.Tag
	err := r.db.Where("group_id = ? AND name = ?", groupID, name).First(&tag).Error
	if err != nil {
		return nil, err
	}
	return &tag, nil
}

// GetAllTags retrieves all tags with their groups
func (r *TagRepository) GetAllTags() ([]models.Tag, error) {
	var tags []models.Tag
	err := r.db.Preload("Group").Order("group_id ASC, sort_order ASC, id ASC").Find(&tags).Error
	if err != nil {
		return nil, err
	}
	return tags, nil
}

// UpdateTag updates a tag
func (r *TagRepository) UpdateTag(tag *models.Tag) error {
	return r.db.Save(tag).Error
}

// DeleteTag soft deletes a tag
func (r *TagRepository) DeleteTag(id uint) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		// First remove all account-tag associations
		if err := tx.Where("tag_id = ?", id).Delete(&models.EmailAccountTag{}).Error; err != nil {
			return err
		}
		// Then delete the tag
		return tx.Delete(&models.Tag{}, id).Error
	})
}

// ======================== EmailAccountTag Operations ========================

// GetAccountTags retrieves all tags for an account
func (r *TagRepository) GetAccountTags(accountID uint) ([]models.Tag, error) {
	var tags []models.Tag
	err := r.db.Model(&models.Tag{}).
		Joins("JOIN email_account_tags ON email_account_tags.tag_id = tags.id").
		Where("email_account_tags.email_account_id = ?", accountID).
		Preload("Group").
		Find(&tags).Error
	if err != nil {
		return nil, err
	}
	return tags, nil
}

// SetAccountTags sets the tags for an account (replaces all existing tags)
func (r *TagRepository) SetAccountTags(accountID uint, tagIDs []uint) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		// First, validate mutual exclusion rules
		if len(tagIDs) > 0 {
			// Get all tags with their groups
			var tags []models.Tag
			if err := tx.Preload("Group").Where("id IN ?", tagIDs).Find(&tags).Error; err != nil {
				return err
			}

			// Group tags by group ID and check for mutual exclusion
			groupTags := make(map[uint][]models.Tag)
			for _, tag := range tags {
				groupTags[tag.GroupID] = append(groupTags[tag.GroupID], tag)
			}

			// Check if any single-selection group has more than one tag
			for groupID, groupTagList := range groupTags {
				if len(groupTagList) > 1 {
					// Get the group to check selection type
					var group models.TagGroup
					if err := tx.First(&group, groupID).Error; err != nil {
						return err
					}
					if group.SelectionType == models.TagGroupSelectionSingle {
						return errors.New("标签组 '" + group.Name + "' 为单选类型，只能选择一个标签")
					}
				}
			}
		}

		// Remove all existing tags
		if err := tx.Where("email_account_id = ?", accountID).Delete(&models.EmailAccountTag{}).Error; err != nil {
			return err
		}

		// Add new tags
		for _, tagID := range tagIDs {
			accountTag := models.EmailAccountTag{
				EmailAccountID: accountID,
				TagID:          tagID,
			}
			if err := tx.Create(&accountTag).Error; err != nil {
				return err
			}
		}

		return nil
	})
}

// AddTagToAccount adds a tag to an account (respecting mutual exclusion)
func (r *TagRepository) AddTagToAccount(accountID, tagID uint) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		// Get the tag with its group
		var tag models.Tag
		if err := tx.Preload("Group").First(&tag, tagID).Error; err != nil {
			return err
		}

		// If the group is single-selection, remove other tags from the same group
		if tag.Group != nil && tag.Group.SelectionType == models.TagGroupSelectionSingle {
			// Get all tag IDs in this group
			var groupTagIDs []uint
			if err := tx.Model(&models.Tag{}).Where("group_id = ?", tag.GroupID).Pluck("id", &groupTagIDs).Error; err != nil {
				return err
			}

			// Remove existing tags from this group for this account
			if err := tx.Where("email_account_id = ? AND tag_id IN ?", accountID, groupTagIDs).Delete(&models.EmailAccountTag{}).Error; err != nil {
				return err
			}
		}

		// Check if association already exists
		var existing models.EmailAccountTag
		err := tx.Where("email_account_id = ? AND tag_id = ?", accountID, tagID).First(&existing).Error
		if err == nil {
			// Already exists
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}

		// Create the association
		accountTag := models.EmailAccountTag{
			EmailAccountID: accountID,
			TagID:          tagID,
		}
		return tx.Create(&accountTag).Error
	})
}

// RemoveTagFromAccount removes a tag from an account
func (r *TagRepository) RemoveTagFromAccount(accountID, tagID uint) error {
	return r.db.Where("email_account_id = ? AND tag_id = ?", accountID, tagID).Delete(&models.EmailAccountTag{}).Error
}

// BatchSetAccountTags sets tags for multiple accounts
func (r *TagRepository) BatchSetAccountTags(accountIDs []uint, tagIDs []uint) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		// Validate mutual exclusion rules
		if len(tagIDs) > 0 {
			var tags []models.Tag
			if err := tx.Preload("Group").Where("id IN ?", tagIDs).Find(&tags).Error; err != nil {
				return err
			}

			groupTags := make(map[uint][]models.Tag)
			for _, tag := range tags {
				groupTags[tag.GroupID] = append(groupTags[tag.GroupID], tag)
			}

			for groupID, groupTagList := range groupTags {
				if len(groupTagList) > 1 {
					var group models.TagGroup
					if err := tx.First(&group, groupID).Error; err != nil {
						return err
					}
					if group.SelectionType == models.TagGroupSelectionSingle {
						return errors.New("标签组 '" + group.Name + "' 为单选类型，只能选择一个标签")
					}
				}
			}
		}

		for _, accountID := range accountIDs {
			// Remove all existing tags
			if err := tx.Where("email_account_id = ?", accountID).Delete(&models.EmailAccountTag{}).Error; err != nil {
				return err
			}

			// Add new tags
			for _, tagID := range tagIDs {
				accountTag := models.EmailAccountTag{
					EmailAccountID: accountID,
					TagID:          tagID,
				}
				if err := tx.Create(&accountTag).Error; err != nil {
					return err
				}
			}
		}

		return nil
	})
}

// BatchAddTagToAccounts adds a tag to multiple accounts
func (r *TagRepository) BatchAddTagToAccounts(accountIDs []uint, tagID uint) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		// Get the tag with its group
		var tag models.Tag
		if err := tx.Preload("Group").First(&tag, tagID).Error; err != nil {
			return err
		}

		for _, accountID := range accountIDs {
			// If the group is single-selection, remove other tags from the same group
			if tag.Group != nil && tag.Group.SelectionType == models.TagGroupSelectionSingle {
				var groupTagIDs []uint
				if err := tx.Model(&models.Tag{}).Where("group_id = ?", tag.GroupID).Pluck("id", &groupTagIDs).Error; err != nil {
					return err
				}
				if err := tx.Where("email_account_id = ? AND tag_id IN ?", accountID, groupTagIDs).Delete(&models.EmailAccountTag{}).Error; err != nil {
					return err
				}
			}

			// Check if already exists
			var existing models.EmailAccountTag
			err := tx.Where("email_account_id = ? AND tag_id = ?", accountID, tagID).First(&existing).Error
			if err == nil {
				continue // Already exists
			}
			if !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}

			// Create the association
			accountTag := models.EmailAccountTag{
				EmailAccountID: accountID,
				TagID:          tagID,
			}
			if err := tx.Create(&accountTag).Error; err != nil {
				return err
			}
		}

		return nil
	})
}

// BatchRemoveTagFromAccounts removes a tag from multiple accounts
func (r *TagRepository) BatchRemoveTagFromAccounts(accountIDs []uint, tagID uint) error {
	return r.db.Where("email_account_id IN ? AND tag_id = ?", accountIDs, tagID).Delete(&models.EmailAccountTag{}).Error
}

// GetAccountIDsByTags retrieves account IDs that have the specified tags
// filterMode: "or" = accounts with ANY of the tags, "and" = accounts with ALL of the tags
func (r *TagRepository) GetAccountIDsByTags(tagIDs []uint, filterMode string) ([]uint, error) {
	if len(tagIDs) == 0 {
		return nil, nil
	}

	var accountIDs []uint

	if filterMode == "and" {
		// Accounts must have ALL tags
		subQuery := r.db.Model(&models.EmailAccountTag{}).
			Select("email_account_id").
			Where("tag_id IN ?", tagIDs).
			Group("email_account_id").
			Having("COUNT(DISTINCT tag_id) = ?", len(tagIDs))

		if err := r.db.Model(&models.EmailAccountTag{}).
			Select("DISTINCT email_account_id").
			Where("email_account_id IN (?)", subQuery).
			Pluck("email_account_id", &accountIDs).Error; err != nil {
			return nil, err
		}
	} else {
		// Accounts with ANY of the tags (OR mode)
		if err := r.db.Model(&models.EmailAccountTag{}).
			Select("DISTINCT email_account_id").
			Where("tag_id IN ?", tagIDs).
			Pluck("email_account_id", &accountIDs).Error; err != nil {
			return nil, err
		}
	}

	return accountIDs, nil
}

// GetTagUsageCount returns the number of accounts using each tag
func (r *TagRepository) GetTagUsageCount() (map[uint]int64, error) {
	type result struct {
		TagID uint
		Count int64
	}

	var results []result
	err := r.db.Model(&models.EmailAccountTag{}).
		Select("tag_id, COUNT(*) as count").
		Group("tag_id").
		Find(&results).Error

	if err != nil {
		return nil, err
	}

	counts := make(map[uint]int64)
	for _, r := range results {
		counts[r.TagID] = r.Count
	}

	return counts, nil
}
