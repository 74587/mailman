package api

import (
	"encoding/json"
	"mailman/internal/models"
	"mailman/internal/repository"
	"mailman/internal/utils"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/mux"
)

// getRolePriority 返回角色优先级（越大越高）
// 用于角色层级保护：低层级用户不能修改高层级用户的角色
func getRolePriority(roleName string) int {
	switch roleName {
	case models.RoleSuperAdmin:
		return 100
	case models.RoleOrgOwner:
		return 80
	case models.RoleOrgAdmin:
		return 60
	case models.RoleMember:
		return 40
	case models.RoleViewer:
		return 20
	default:
		return 10
	}
}

// OrganizationHandler 组织管理 Handler
type OrganizationHandler struct {
	orgRepo    *repository.OrganizationRepository
	memberRepo *repository.OrgMemberRepository
	roleRepo   *repository.RoleRepository
	userRepo   *repository.UserRepository
	logger     *utils.Logger
}

// NewOrganizationHandler creates a new organization handler
func NewOrganizationHandler(
	orgRepo *repository.OrganizationRepository,
	memberRepo *repository.OrgMemberRepository,
	roleRepo *repository.RoleRepository,
	userRepo *repository.UserRepository,
) *OrganizationHandler {
	return &OrganizationHandler{
		orgRepo:    orgRepo,
		memberRepo: memberRepo,
		roleRepo:   roleRepo,
		userRepo:   userRepo,
		logger:     utils.NewLogger("OrganizationHandler"),
	}
}

// --- 组织 CRUD ---

// CreateOrganizationRequest 创建组织请求
type CreateOrganizationRequest struct {
	Name        string `json:"name"`
	Slug        string `json:"slug"`
	Description string `json:"description,omitempty"`
}

// CreateOrganizationHandler 创建组织（仅超级管理员）
func (h *OrganizationHandler) CreateOrganizationHandler(w http.ResponseWriter, r *http.Request) {
	var req CreateOrganizationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Name == "" || req.Slug == "" {
		http.Error(w, "Name and slug are required", http.StatusBadRequest)
		return
	}

	// slug 格式校验：只允许小写字母、数字、连字符
	slug := strings.ToLower(strings.TrimSpace(req.Slug))
	for _, c := range slug {
		if !((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-') {
			http.Error(w, "Slug can only contain lowercase letters, numbers, and hyphens", http.StatusBadRequest)
			return
		}
	}

	org := models.Organization{
		Name:        req.Name,
		Slug:        slug,
		Description: req.Description,
		IsActive:    true,
	}

	if err := h.orgRepo.Create(&org); err != nil {
		if strings.Contains(err.Error(), "UNIQUE") || strings.Contains(err.Error(), "duplicate") {
			http.Error(w, "Organization slug already exists", http.StatusConflict)
			return
		}
		http.Error(w, "Failed to create organization", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(org)
}

// GetOrganizationsHandler 获取当前用户的组织列表
func (h *OrganizationHandler) GetOrganizationsHandler(w http.ResponseWriter, r *http.Request) {
	user := GetCurrentUser(r)
	if user == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var orgs []models.Organization
	var err error

	if user.IsSuperAdmin {
		// 超级管理员可以看到所有组织
		orgs, err = h.orgRepo.GetAll()
	} else {
		orgs, err = h.orgRepo.GetUserOrganizations(user.ID)
	}

	if err != nil {
		http.Error(w, "Failed to get organizations", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(orgs)
}

// GetOrganizationHandler 获取单个组织详情
func (h *OrganizationHandler) GetOrganizationHandler(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseUint(mux.Vars(r)["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid organization ID", http.StatusBadRequest)
		return
	}

	org, err := h.orgRepo.GetByID(uint(id))
	if err != nil {
		http.Error(w, "Organization not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(org)
}

// UpdateOrganizationHandler 更新组织
func (h *OrganizationHandler) UpdateOrganizationHandler(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseUint(mux.Vars(r)["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid organization ID", http.StatusBadRequest)
		return
	}

	org, err := h.orgRepo.GetByID(uint(id))
	if err != nil {
		http.Error(w, "Organization not found", http.StatusNotFound)
		return
	}

	var req CreateOrganizationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Name != "" {
		org.Name = req.Name
	}
	if req.Description != "" {
		org.Description = req.Description
	}

	if err := h.orgRepo.Update(org); err != nil {
		http.Error(w, "Failed to update organization", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(org)
}

// DeleteOrganizationHandler 删除组织（仅超级管理员）
func (h *OrganizationHandler) DeleteOrganizationHandler(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseUint(mux.Vars(r)["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid organization ID", http.StatusBadRequest)
		return
	}

	if err := h.orgRepo.Delete(uint(id)); err != nil {
		http.Error(w, "Failed to delete organization", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// SwitchOrganizationHandler 切换当前组织
func (h *OrganizationHandler) SwitchOrganizationHandler(w http.ResponseWriter, r *http.Request) {
	user := GetCurrentUser(r)
	if user == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req struct {
		OrgID uint `json:"orgId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// 验证用户是否属于目标组织（超级管理员可以切换到任意组织）
	if !user.IsSuperAdmin {
		_, err := h.memberRepo.GetByOrgAndUser(req.OrgID, user.ID)
		if err != nil {
			http.Error(w, "You are not a member of this organization", http.StatusForbidden)
			return
		}
	}

	// 更新用户的 CurrentOrgID
	user.CurrentOrgID = &req.OrgID
	if err := h.userRepo.Update(user); err != nil {
		http.Error(w, "Failed to switch organization", http.StatusInternalServerError)
		return
	}

	org, _ := h.orgRepo.GetByID(req.OrgID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"message":      "Organization switched successfully",
		"organization": org,
	})
}

// --- 成员管理 ---

// AddMemberRequest 添加成员请求
type AddMemberRequest struct {
	UserID uint   `json:"userId"`
	RoleID uint   `json:"roleId"`
}

// GetOrgMembersHandler 获取组织成员列表
func (h *OrganizationHandler) GetOrgMembersHandler(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseUint(mux.Vars(r)["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid organization ID", http.StatusBadRequest)
		return
	}

	members, err := h.memberRepo.GetOrgMembers(uint(id))
	if err != nil {
		http.Error(w, "Failed to get members", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(members)
}

// AddOrgMemberHandler 添加组织成员
func (h *OrganizationHandler) AddOrgMemberHandler(w http.ResponseWriter, r *http.Request) {
	// 权限检查：需要 org_member:create 权限
	if !CheckPermissionOrForbid(w, r, models.ResourceOrgMember, models.ActionCreate) {
		return
	}

	orgID, err := strconv.ParseUint(mux.Vars(r)["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid organization ID", http.StatusBadRequest)
		return
	}

	var req AddMemberRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// 检查用户是否存在
	_, err = h.userRepo.GetByID(req.UserID)
	if err != nil {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}

	// 检查用户是否已经是成员
	existing, _ := h.memberRepo.GetByOrgAndUser(uint(orgID), req.UserID)
	if existing != nil {
		http.Error(w, "User is already a member of this organization", http.StatusConflict)
		return
	}

	// 验证角色是否存在
	assignRole, err := h.roleRepo.GetByID(req.RoleID)
	if err != nil {
		http.Error(w, "Role not found", http.StatusBadRequest)
		return
	}

	// 角色层级保护：不能分配比自己更高或同级的角色（超管除外）
	currentUser := GetCurrentUser(r)
	if currentUser != nil && !currentUser.IsSuperAdmin {
		currentRole := GetCurrentUserRole(r)
		if currentRole != nil && getRolePriority(assignRole.Name) >= getRolePriority(currentRole.Name) {
			http.Error(w, "Cannot assign a role equal to or higher than your own", http.StatusForbidden)
			return
		}
	}

	member := models.OrgMember{
		OrgID:    uint(orgID),
		UserID:   req.UserID,
		RoleID:   req.RoleID,
		JoinedAt: time.Now(),
	}

	if err := h.memberRepo.Create(&member); err != nil {
		http.Error(w, "Failed to add member", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(member)
}

// UpdateMemberRoleHandler 更新成员角色
func (h *OrganizationHandler) UpdateMemberRoleHandler(w http.ResponseWriter, r *http.Request) {
	// 权限检查：需要 org_member:update 权限
	if !CheckPermissionOrForbid(w, r, models.ResourceOrgMember, models.ActionUpdate) {
		return
	}

	orgID, err := strconv.ParseUint(mux.Vars(r)["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid organization ID", http.StatusBadRequest)
		return
	}

	userID, err := strconv.ParseUint(mux.Vars(r)["userId"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid user ID", http.StatusBadRequest)
		return
	}

	// 不能修改自己的角色
	currentUser := GetCurrentUser(r)
	if currentUser != nil && currentUser.ID == uint(userID) {
		http.Error(w, "Cannot modify your own role", http.StatusForbidden)
		return
	}

	// 检查目标用户是否是超级管理员
	targetUser, err := h.userRepo.GetByID(uint(userID))
	if err != nil {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}
	if targetUser.IsSuperAdmin {
		http.Error(w, "Cannot modify super admin's role", http.StatusForbidden)
		return
	}

	var req struct {
		RoleID uint `json:"roleId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	member, err := h.memberRepo.GetByOrgAndUser(uint(orgID), uint(userID))
	if err != nil {
		http.Error(w, "Member not found", http.StatusNotFound)
		return
	}

	// 角色层级保护（超管除外）
	if currentUser != nil && !currentUser.IsSuperAdmin {
		currentRole := GetCurrentUserRole(r)
		if currentRole != nil {
			// 不能修改比自己角色高或同级的成员
			targetRole, _ := h.roleRepo.GetByID(member.RoleID)
			if targetRole != nil && getRolePriority(targetRole.Name) >= getRolePriority(currentRole.Name) {
				http.Error(w, "Cannot modify a member with equal or higher role", http.StatusForbidden)
				return
			}
			// 不能将成员提升到和自己相同或更高的角色
			newRole, _ := h.roleRepo.GetByID(req.RoleID)
			if newRole != nil && getRolePriority(newRole.Name) >= getRolePriority(currentRole.Name) {
				http.Error(w, "Cannot assign a role equal to or higher than your own", http.StatusForbidden)
				return
			}
		}
	}

	if err := h.memberRepo.UpdateRole(member.ID, req.RoleID); err != nil {
		http.Error(w, "Failed to update role", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Role updated successfully"})
}

// RemoveMemberHandler 移除组织成员
func (h *OrganizationHandler) RemoveMemberHandler(w http.ResponseWriter, r *http.Request) {
	// 权限检查：需要 org_member:delete 权限
	if !CheckPermissionOrForbid(w, r, models.ResourceOrgMember, models.ActionDelete) {
		return
	}

	orgID, err := strconv.ParseUint(mux.Vars(r)["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid organization ID", http.StatusBadRequest)
		return
	}

	userID, err := strconv.ParseUint(mux.Vars(r)["userId"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid user ID", http.StatusBadRequest)
		return
	}

	// 不能移除自己
	currentUser := GetCurrentUser(r)
	if currentUser != nil && currentUser.ID == uint(userID) {
		http.Error(w, "Cannot remove yourself from the organization", http.StatusForbidden)
		return
	}

	// 检查目标用户是否是超级管理员
	targetUser, err := h.userRepo.GetByID(uint(userID))
	if err != nil {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}
	if targetUser.IsSuperAdmin {
		http.Error(w, "Cannot remove super admin from the organization", http.StatusForbidden)
		return
	}

	// 角色层级保护：不能移除比自己角色高或同级的成员（超管除外）
	if currentUser != nil && !currentUser.IsSuperAdmin {
		currentRole := GetCurrentUserRole(r)
		targetMember, _ := h.memberRepo.GetByOrgAndUser(uint(orgID), uint(userID))
		if currentRole != nil && targetMember != nil {
			targetRole, _ := h.roleRepo.GetByID(targetMember.RoleID)
			if targetRole != nil && getRolePriority(targetRole.Name) >= getRolePriority(currentRole.Name) {
				http.Error(w, "Cannot remove a member with equal or higher role", http.StatusForbidden)
				return
			}
		}
	}

	if err := h.memberRepo.DeleteByOrgAndUser(uint(orgID), uint(userID)); err != nil {
		http.Error(w, "Failed to remove member", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// GetRolesHandler 获取组织可用的角色（系统角色 + 组织自定义角色）
func (h *OrganizationHandler) GetRolesHandler(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)

	var roles []models.Role
	var err error

	if orgID == 0 {
		// 超级管理员或无组织上下文时，返回系统角色
		roles, err = h.roleRepo.GetSystemRoles()
	} else {
		roles, err = h.roleRepo.GetOrgRoles(orgID)
	}

	if err != nil {
		http.Error(w, "Failed to get roles", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(roles)
}

// CreateRoleRequest 创建角色请求
type CreateRoleRequest struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
}

// CreateRoleHandler 创建自定义角色
func (h *OrganizationHandler) CreateRoleHandler(w http.ResponseWriter, r *http.Request) {
	// 权限检查：需要 organization:manage 权限
	if !CheckPermissionOrForbid(w, r, models.ResourceOrganization, models.ActionManage) {
		return
	}

	orgID := GetCurrentOrgID(r)
	if orgID == 0 {
		http.Error(w, "Organization context required", http.StatusBadRequest)
		return
	}

	var req CreateRoleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Name == "" {
		http.Error(w, "Name is required", http.StatusBadRequest)
		return
	}

	role := models.Role{
		OrgID:       &orgID,
		Name:        req.Name,
		Description: req.Description,
		IsSystem:    false,
	}

	if err := h.roleRepo.Create(&role); err != nil {
		http.Error(w, "Failed to create role", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(role)
}

// UpdateRoleHandler 更新角色
func (h *OrganizationHandler) UpdateRoleHandler(w http.ResponseWriter, r *http.Request) {
	// 权限检查：需要 organization:manage 权限
	if !CheckPermissionOrForbid(w, r, models.ResourceOrganization, models.ActionManage) {
		return
	}

	id, err := strconv.ParseUint(mux.Vars(r)["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid role ID", http.StatusBadRequest)
		return
	}

	role, err := h.roleRepo.GetByID(uint(id))
	if err != nil {
		http.Error(w, "Role not found", http.StatusNotFound)
		return
	}

	if role.IsSystem {
		http.Error(w, "System roles cannot be modified", http.StatusForbidden)
		return
	}

	var req CreateRoleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Name != "" {
		role.Name = req.Name
	}
	if req.Description != "" {
		role.Description = req.Description
	}

	if err := h.roleRepo.Update(role); err != nil {
		http.Error(w, "Failed to update role", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(role)
}

// DeleteRoleHandler 删除角色
func (h *OrganizationHandler) DeleteRoleHandler(w http.ResponseWriter, r *http.Request) {
	// 权限检查：需要 organization:manage 权限
	if !CheckPermissionOrForbid(w, r, models.ResourceOrganization, models.ActionManage) {
		return
	}

	id, err := strconv.ParseUint(mux.Vars(r)["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid role ID", http.StatusBadRequest)
		return
	}

	if err := h.roleRepo.Delete(uint(id)); err != nil {
		if strings.Contains(err.Error(), "system roles") {
			http.Error(w, err.Error(), http.StatusForbidden)
			return
		}
		http.Error(w, "Failed to delete role", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// GetPermissionsHandler 获取所有可用权限
func (h *OrganizationHandler) GetPermissionsHandler(w http.ResponseWriter, r *http.Request) {
	permissions, err := h.roleRepo.GetAllPermissions()
	if err != nil {
		http.Error(w, "Failed to get permissions", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(permissions)
}

// SetRolePermissionsRequest 设置角色权限请求
type SetRolePermissionsRequest struct {
	PermissionIDs []uint `json:"permissionIds"`
}

// SetRolePermissionsHandler 设置角色的权限
func (h *OrganizationHandler) SetRolePermissionsHandler(w http.ResponseWriter, r *http.Request) {
	// 权限检查：需要 organization:manage 权限
	if !CheckPermissionOrForbid(w, r, models.ResourceOrganization, models.ActionManage) {
		return
	}

	id, err := strconv.ParseUint(mux.Vars(r)["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid role ID", http.StatusBadRequest)
		return
	}

	// 验证角色存在
	role, err := h.roleRepo.GetByID(uint(id))
	if err != nil {
		http.Error(w, "Role not found", http.StatusNotFound)
		return
	}

	// 系统角色的权限不可修改
	if role.IsSystem {
		http.Error(w, "System role permissions cannot be modified", http.StatusForbidden)
		return
	}

	var req SetRolePermissionsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if err := h.roleRepo.SetRolePermissions(uint(id), req.PermissionIDs); err != nil {
		http.Error(w, "Failed to set role permissions", http.StatusInternalServerError)
		return
	}

	// 返回更新后的权限列表
	permissions, err := h.roleRepo.GetRolePermissions(uint(id))
	if err != nil {
		http.Error(w, "Failed to get updated permissions", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"message":     "Permissions updated successfully",
		"permissions": permissions,
	})
}
