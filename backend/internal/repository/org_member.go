package repository

import (
	"fmt"
	"mailman/internal/models"
	"sync"

	"gorm.io/gorm"
)

// OrgMemberRepository 组织成员数据库操作
type OrgMemberRepository struct {
	db *gorm.DB
	mu sync.RWMutex
}

// NewOrgMemberRepository creates a new org member repository
func NewOrgMemberRepository(db *gorm.DB) *OrgMemberRepository {
	return &OrgMemberRepository{db: db}
}

// Create 添加成员
func (r *OrgMemberRepository) Create(member *models.OrgMember) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.db.Create(member).Error
}

// GetByID 根据ID获取成员记录
func (r *OrgMemberRepository) GetByID(id uint) (*models.OrgMember, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var member models.OrgMember
	if err := r.db.First(&member, id).Error; err != nil {
		return nil, err
	}
	return &member, nil
}

// GetByOrgAndUser 查找指定组织中的指定用户
func (r *OrgMemberRepository) GetByOrgAndUser(orgID, userID uint) (*models.OrgMember, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var member models.OrgMember
	if err := r.db.Where("org_id = ? AND user_id = ?", orgID, userID).First(&member).Error; err != nil {
		return nil, err
	}
	return &member, nil
}

// GetOrgMembers 获取组织的所有成员（含用户和角色详情）
func (r *OrgMemberRepository) GetOrgMembers(orgID uint) ([]models.OrgMemberWithDetails, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var members []models.OrgMember
	if err := r.db.Where("org_id = ?", orgID).Order("joined_at ASC").Find(&members).Error; err != nil {
		return nil, err
	}

	// 手动加载关联数据（不使用外键）
	result := make([]models.OrgMemberWithDetails, len(members))
	for i, m := range members {
		result[i].OrgMember = m

		var user models.User
		if err := r.db.First(&user, m.UserID).Error; err == nil {
			result[i].User = &user
		}

		var role models.Role
		if err := r.db.First(&role, m.RoleID).Error; err == nil {
			result[i].Role = &role
		}
	}

	return result, nil
}

// GetUserMemberships 获取用户的所有组织成员记录
func (r *OrgMemberRepository) GetUserMemberships(userID uint) ([]models.OrgMember, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var members []models.OrgMember
	if err := r.db.Where("user_id = ?", userID).Find(&members).Error; err != nil {
		return nil, err
	}
	return members, nil
}

// UpdateRole 更新成员角色
func (r *OrgMemberRepository) UpdateRole(id uint, roleID uint) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.db.Model(&models.OrgMember{}).Where("id = ?", id).Update("role_id", roleID).Error
}

// Delete 移除成员
func (r *OrgMemberRepository) Delete(id uint) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.db.Delete(&models.OrgMember{}, id).Error
}

// DeleteByOrgAndUser 根据组织ID和用户ID移除成员
func (r *OrgMemberRepository) DeleteByOrgAndUser(orgID, userID uint) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.db.Where("org_id = ? AND user_id = ?", orgID, userID).Delete(&models.OrgMember{}).Error
}

// CountByOrg 获取组织成员数量
func (r *OrgMemberRepository) CountByOrg(orgID uint) (int64, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var count int64
	err := r.db.Model(&models.OrgMember{}).Where("org_id = ?", orgID).Count(&count).Error
	return count, err
}

// RoleRepository 角色数据库操作
type RoleRepository struct {
	db *gorm.DB
	mu sync.RWMutex
}

// NewRoleRepository creates a new role repository
func NewRoleRepository(db *gorm.DB) *RoleRepository {
	return &RoleRepository{db: db}
}

// GetByID 根据ID获取角色
func (r *RoleRepository) GetByID(id uint) (*models.Role, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var role models.Role
	if err := r.db.First(&role, id).Error; err != nil {
		return nil, err
	}
	return &role, nil
}

// GetByName 根据名称获取角色
func (r *RoleRepository) GetByName(name string) (*models.Role, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var role models.Role
	if err := r.db.Where("name = ? AND is_system = ?", name, true).First(&role).Error; err != nil {
		return nil, err
	}
	return &role, nil
}

// GetSystemRoles 获取所有系统角色
func (r *RoleRepository) GetSystemRoles() ([]models.Role, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var roles []models.Role
	if err := r.db.Where("is_system = ?", true).Order("id ASC").Find(&roles).Error; err != nil {
		return nil, err
	}
	return roles, nil
}

// GetRolePermissions 获取角色拥有的所有权限
func (r *RoleRepository) GetRolePermissions(roleID uint) ([]models.Permission, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var permissions []models.Permission
	err := r.db.Where("id IN (SELECT permission_id FROM role_permissions WHERE role_id = ?)", roleID).
		Find(&permissions).Error
	return permissions, err
}

// HasPermission 检查角色是否拥有指定权限
func (r *RoleRepository) HasPermission(roleID uint, resource, action string) (bool, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var count int64
	err := r.db.Model(&models.RolePermission{}).
		Where("role_id = ? AND permission_id IN (SELECT id FROM permissions WHERE resource = ? AND action = ?)",
			roleID, resource, action).
		Count(&count).Error
	return count > 0, err
}

// Create 创建角色
func (r *RoleRepository) Create(role *models.Role) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.db.Create(role).Error
}

// Update 更新角色
func (r *RoleRepository) Update(role *models.Role) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.db.Save(role).Error
}

// Delete 删除角色（系统角色不可删除）
func (r *RoleRepository) Delete(id uint) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	// 检查是否为系统角色
	var role models.Role
	if err := r.db.First(&role, id).Error; err != nil {
		return err
	}
	if role.IsSystem {
		return fmt.Errorf("system roles cannot be deleted")
	}

	// 删除角色的权限关联
	if err := r.db.Where("role_id = ?", id).Delete(&models.RolePermission{}).Error; err != nil {
		return err
	}

	return r.db.Delete(&models.Role{}, id).Error
}

// GetOrgRoles 获取组织可用的角色（系统角色 + 组织自定义角色）
func (r *RoleRepository) GetOrgRoles(orgID uint) ([]models.Role, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var roles []models.Role
	if err := r.db.Where("is_system = ? OR org_id = ?", true, orgID).Order("is_system DESC, id ASC").Find(&roles).Error; err != nil {
		return nil, err
	}
	return roles, nil
}

// GetAllPermissions 获取所有权限
func (r *RoleRepository) GetAllPermissions() ([]models.Permission, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var permissions []models.Permission
	if err := r.db.Order("resource ASC, action ASC").Find(&permissions).Error; err != nil {
		return nil, err
	}
	return permissions, nil
}

// SetRolePermissions 设置角色的权限（替换所有现有权限）
func (r *RoleRepository) SetRolePermissions(roleID uint, permissionIDs []uint) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	return r.db.Transaction(func(tx *gorm.DB) error {
		// 删除现有权限关联
		if err := tx.Where("role_id = ?", roleID).Delete(&models.RolePermission{}).Error; err != nil {
			return err
		}

		// 批量创建新的权限关联
		for _, permID := range permissionIDs {
			rp := models.RolePermission{
				RoleID:       roleID,
				PermissionID: permID,
			}
			if err := tx.Create(&rp).Error; err != nil {
				return err
			}
		}

		return nil
	})
}
