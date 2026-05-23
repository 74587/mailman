package api

import (
	"encoding/json"
	"mailman/internal/models"
	"mailman/internal/repository"
	"mailman/internal/utils"
	"net/http"
	"strconv"

	"github.com/gorilla/mux"
)

// UserManagementHandler 用户管理 Handler（仅超级管理员使用）
type UserManagementHandler struct {
	userRepo   *repository.UserRepository
	memberRepo *repository.OrgMemberRepository
	roleRepo   *repository.RoleRepository
	logger     *utils.Logger
}

// NewUserManagementHandler creates a new user management handler
func NewUserManagementHandler(
	userRepo *repository.UserRepository,
	memberRepo *repository.OrgMemberRepository,
	roleRepo *repository.RoleRepository,
) *UserManagementHandler {
	return &UserManagementHandler{
		userRepo:   userRepo,
		memberRepo: memberRepo,
		roleRepo:   roleRepo,
		logger:     utils.NewLogger("UserManagement"),
	}
}

// CreateUserRequest 创建用户请求
type CreateUserRequest struct {
	Username string `json:"username"`
	Email    string `json:"email"`
	Password string `json:"password"`
	OrgID    *uint  `json:"orgId,omitempty"`  // 可选，创建时直接加入组织
	RoleID   *uint  `json:"roleId,omitempty"` // 可选，加入组织时的角色
}

// AdminUpdateUserRequest 管理员更新用户请求
type AdminUpdateUserRequest struct {
	Username     string `json:"username,omitempty"`
	Email        string `json:"email,omitempty"`
	Password     string `json:"password,omitempty"`
	IsActive     *bool  `json:"isActive,omitempty"`
	IsSuperAdmin *bool  `json:"isSuperAdmin,omitempty"`
}

// UserResponse 用户响应（包含组织信息）
type UserResponse struct {
	models.User
	Organizations []UserOrgInfo `json:"organizations,omitempty"`
}

// UserOrgInfo 用户组织信息
type UserOrgInfo struct {
	OrgID    uint   `json:"orgId"`
	OrgName  string `json:"orgName"`
	OrgSlug  string `json:"orgSlug"`
	RoleID   uint   `json:"roleId"`
	RoleName string `json:"roleName"`
}

// ListUsersHandler 列出所有用户（超级管理员）
func (h *UserManagementHandler) ListUsersHandler(w http.ResponseWriter, r *http.Request) {
	var users []models.User
	// 使用 Count 获取总数，然后分页查询
	// 简单实现：直接返回所有用户
	page := 1
	limit := 50

	if p := r.URL.Query().Get("page"); p != "" {
		if val, err := strconv.Atoi(p); err == nil && val > 0 {
			page = val
		}
	}
	if l := r.URL.Query().Get("limit"); l != "" {
		if val, err := strconv.Atoi(l); err == nil && val > 0 && val <= 100 {
			limit = val
		}
	}

	var total int64
	total, _ = h.userRepo.Count()

	offset := (page - 1) * limit
	// 直接使用 db 查询用户列表（UserRepository 没有分页方法，使用简单查询）
	users, err := h.userRepo.ListAll(limit, offset)
	if err != nil {
		http.Error(w, "Failed to list users", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"data":  users,
		"total": total,
		"page":  page,
		"limit": limit,
	})
}

// CreateUserHandler 创建用户（超级管理员）
// 不允许自注册，只能由超级管理员创建
func (h *UserManagementHandler) CreateUserHandler(w http.ResponseWriter, r *http.Request) {
	var req CreateUserRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Username == "" || req.Email == "" || req.Password == "" {
		http.Error(w, "Username, email, and password are required", http.StatusBadRequest)
		return
	}

	// 创建用户
	user := &models.User{
		Username: req.Username,
		Email:    req.Email,
		IsActive: true,
	}

	if err := user.SetPassword(req.Password); err != nil {
		http.Error(w, "Failed to set password", http.StatusInternalServerError)
		return
	}

	if err := h.userRepo.Create(user); err != nil {
		http.Error(w, "Failed to create user: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// 如果指定了组织，将用户加入该组织
	if req.OrgID != nil {
		roleID := uint(0)
		if req.RoleID != nil {
			roleID = *req.RoleID
		} else {
			// 默认角色为 member
			defaultRole, err := h.roleRepo.GetByName(models.RoleMember)
			if err == nil {
				roleID = defaultRole.ID
			}
		}

		if roleID > 0 {
			member := &models.OrgMember{
				OrgID:  *req.OrgID,
				UserID: user.ID,
				RoleID: roleID,
			}
			if err := h.memberRepo.Create(member); err != nil {
				h.logger.Warn("User created but failed to add to org %d: %v", *req.OrgID, err)
			} else {
				// 设置用户的默认组织
				user.CurrentOrgID = req.OrgID
				h.userRepo.Update(user)
			}
		}
	}

	h.logger.Info("User '%s' created by admin", user.Username)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(user)
}

// GetUserHandler 获取单个用户详情（超级管理员）
func (h *UserManagementHandler) GetUserHandler(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseUint(mux.Vars(r)["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid user ID", http.StatusBadRequest)
		return
	}

	user, err := h.userRepo.GetByID(uint(id))
	if err != nil {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(user)
}

// UpdateUserHandler 更新用户（超级管理员）
func (h *UserManagementHandler) UpdateUserHandler(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseUint(mux.Vars(r)["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid user ID", http.StatusBadRequest)
		return
	}

	user, err := h.userRepo.GetByID(uint(id))
	if err != nil {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}

	var req AdminUpdateUserRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Username != "" {
		user.Username = req.Username
	}
	if req.Email != "" {
		user.Email = req.Email
	}
	if req.Password != "" {
		if err := user.SetPassword(req.Password); err != nil {
			http.Error(w, "Failed to set password", http.StatusInternalServerError)
			return
		}
	}
	if req.IsActive != nil {
		user.IsActive = *req.IsActive
	}
	if req.IsSuperAdmin != nil {
		user.IsSuperAdmin = *req.IsSuperAdmin
	}

	if err := h.userRepo.Update(user); err != nil {
		http.Error(w, "Failed to update user", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(user)
}

// DeleteUserHandler 禁用/删除用户（超级管理员）
func (h *UserManagementHandler) DeleteUserHandler(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseUint(mux.Vars(r)["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid user ID", http.StatusBadRequest)
		return
	}

	// 不允许删除自己
	currentUser := GetCurrentUser(r)
	if currentUser != nil && currentUser.ID == uint(id) {
		http.Error(w, "Cannot delete yourself", http.StatusBadRequest)
		return
	}

	user, err := h.userRepo.GetByID(uint(id))
	if err != nil {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}

	// 禁用用户而非物理删除
	user.IsActive = false
	if err := h.userRepo.Update(user); err != nil {
		http.Error(w, "Failed to disable user", http.StatusInternalServerError)
		return
	}

	h.logger.Info("User '%s' disabled by admin", user.Username)
	w.WriteHeader(http.StatusNoContent)
}
