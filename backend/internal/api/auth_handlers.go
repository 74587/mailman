package api

import (
	"encoding/base64"
	"encoding/json"
	"mailman/internal/models"
	"mailman/internal/repository"
	"mailman/internal/services"
	"net/http"
	"strings"
	"time"
)

// AuthHandler handles authentication-related requests
type AuthHandler struct {
	authService      *services.AuthService
	userRepo         *repository.UserRepository
	activityLogger   *services.ActivityLogger
	LoginRateLimiter *services.RateLimiter
}

// NewAuthHandler creates a new auth handler
func NewAuthHandler(authService *services.AuthService, userRepo *repository.UserRepository) *AuthHandler {
	return &AuthHandler{
		authService:      authService,
		userRepo:         userRepo,
		activityLogger:   services.GetActivityLogger(),
		LoginRateLimiter: services.NewRateLimiter(5, 15*time.Minute),
	}
}

// LoginRequest represents a login request
type LoginRequest struct {
	Username string `json:"username" validate:"required"`
	Password string `json:"password" validate:"required"`
}

// LoginResponse represents a login response
type LoginResponse struct {
	Token     string `json:"token"`
	ExpiresAt string `json:"expires_at"`
	User      struct {
		ID       uint   `json:"id"`
		Username string `json:"username"`
		Email    string `json:"email"`
		Avatar   string `json:"avatar,omitempty"`
	} `json:"user"`
}

// LoginHandler handles user login
// @Summary User login
// @Description Authenticate user and create session
// @Tags auth
// @Accept json
// @Produce json
// @Param request body LoginRequest true "Login credentials"
// @Success 200 {object} LoginResponse
// @Failure 400 {object} map[string]string
// @Failure 401 {object} map[string]string
// @Router /api/auth/login [post]
func (h *AuthHandler) LoginHandler(w http.ResponseWriter, r *http.Request) {
	var req LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Check if this is the first user (silent registration)
	count, err := h.userRepo.Count()
	if err != nil {
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	if count == 0 {
		// First user - perform silent registration
		// Validate password length
		if len(req.Password) < 8 {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "Password must be at least 8 characters long"})
			return
		}

		// Use username as email if it looks like an email
		email := req.Username
		username := req.Username
		if !strings.Contains(email, "@") {
			// If username is not an email, create a default email
			email = username + "@localhost"
		}

		user, err := h.authService.RegisterFirstUser(username, email, req.Password)
		if err != nil {
			http.Error(w, "Failed to create first user", http.StatusInternalServerError)
			return
		}

		// Continue with login using the created user
		_ = user
	}

	// Perform login
	session, err := h.authService.Login(req.Username, req.Password)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	// Log successful login activity
	ipAddress := r.Header.Get("X-Real-IP")
	if ipAddress == "" {
		ipAddress = r.Header.Get("X-Forwarded-For")
		if ipAddress == "" {
			ipAddress = r.RemoteAddr
		}
	}
	h.activityLogger.LogUserActivity(models.ActivityUserLogin, &session.User, ipAddress)

	// Prepare response
	resp := LoginResponse{
		Token:     session.Token,
		ExpiresAt: session.ExpiresAt.Format(time.RFC3339),
	}
	resp.User.ID = session.User.ID
	resp.User.Username = session.User.Username
	resp.User.Email = session.User.Email
	resp.User.Avatar = session.User.Avatar

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// LogoutHandler handles user logout
// @Summary User logout
// @Description Invalidate user session
// @Tags auth
// @Accept json
// @Produce json
// @Security BearerAuth
// @Success 200 {object} map[string]string
// @Failure 401 {object} map[string]string
// @Router /api/auth/logout [post]
func (h *AuthHandler) LogoutHandler(w http.ResponseWriter, r *http.Request) {
	// Extract token from Authorization header
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" {
		http.Error(w, "Authorization header required", http.StatusUnauthorized)
		return
	}

	parts := strings.Split(authHeader, " ")
	if len(parts) != 2 || parts[0] != "Bearer" {
		http.Error(w, "Invalid authorization header format", http.StatusUnauthorized)
		return
	}

	token := parts[1]

	// Get user info before logout
	user, _ := h.authService.ValidateSession(token)

	// Logout
	if err := h.authService.Logout(token); err != nil {
		http.Error(w, "Failed to logout", http.StatusInternalServerError)
		return
	}

	// Log logout activity
	if user != nil {
		ipAddress := r.Header.Get("X-Real-IP")
		if ipAddress == "" {
			ipAddress = r.Header.Get("X-Forwarded-For")
			if ipAddress == "" {
				ipAddress = r.RemoteAddr
			}
		}
		h.activityLogger.LogUserActivity(models.ActivityUserLogout, user, ipAddress)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Logged out successfully"})
}

// CurrentUserHandler returns the current authenticated user
// @Summary Get current user
// @Description Get information about the currently authenticated user
// @Tags auth
// @Accept json
// @Produce json
// @Security BearerAuth
// @Success 200 {object} models.User
// @Failure 401 {object} map[string]string
// @Router /api/auth/me [get]
func (h *AuthHandler) CurrentUserHandler(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(UserContextKey)
	if user == nil {
		http.Error(w, "User not found in context", http.StatusUnauthorized)
		return
	}

	// 构建增强的响应，包含组织和角色信息
	response := map[string]interface{}{
		"user": user,
	}

	// 添加当前组织信息
	if org := GetCurrentOrg(r); org != nil {
		response["currentOrganization"] = org
	}

	// 添加当前角色信息
	if role := GetCurrentUserRole(r); role != nil {
		response["currentRole"] = role
	}

	// 添加权限列表
	if permissions, ok := r.Context().Value(PermissionsContextKey).([]models.Permission); ok {
		response["permissions"] = permissions
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// UpdateUserRequest 表示用户信息更新请求
type UpdateUserRequest struct {
	Username    string `json:"username,omitempty"`
	Email       string `json:"email,omitempty"`
	Avatar      string `json:"avatar,omitempty"`
	OldPassword string `json:"old_password,omitempty"`
	NewPassword string `json:"new_password,omitempty"`
}

// UpdateUserHandler 处理用户信息更新
// @Summary 更新用户信息
// @Description 更新用户信息，包括头像、用户名、邮箱和密码
// @Tags auth
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body UpdateUserRequest true "用户信息更新数据"
// @Success 200 {object} models.User
// @Failure 400 {object} map[string]string
// @Failure 401 {object} map[string]string
// @Router /api/auth/update [put]
func (h *AuthHandler) UpdateUserHandler(w http.ResponseWriter, r *http.Request) {
	// 从上下文获取当前用户
	currentUser, ok := r.Context().Value(UserContextKey).(*models.User)
	if currentUser == nil || !ok {
		http.Error(w, "用户未认证", http.StatusUnauthorized)
		return
	}

	// 解析请求
	var req UpdateUserRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "无效的请求体", http.StatusBadRequest)
		return
	}

	// 获取用户最新信息
	user, err := h.userRepo.GetByID(currentUser.ID)
	if err != nil {
		http.Error(w, "获取用户信息失败", http.StatusInternalServerError)
		return
	}

	// 更新头像
	if req.Avatar != "" {
		// 验证是否是有效的Base64编码图片
		if isValidBase64Image(req.Avatar) {
			user.Avatar = req.Avatar
		} else {
			http.Error(w, "无效的图片格式", http.StatusBadRequest)
			return
		}
	}

	// 更新用户名
	if req.Username != "" && req.Username != user.Username {
		// 检查用户名是否已存在
		existingUser, err := h.userRepo.GetByUsername(req.Username)
		if err == nil && existingUser.ID != user.ID {
			http.Error(w, "用户名已存在", http.StatusBadRequest)
			return
		}
		user.Username = req.Username
	}

	// 更新邮箱
	if req.Email != "" && req.Email != user.Email {
		// 检查邮箱是否已存在
		existingUser, err := h.userRepo.GetByEmail(req.Email)
		if err == nil && existingUser.ID != user.ID {
			http.Error(w, "邮箱已存在", http.StatusBadRequest)
			return
		}
		user.Email = req.Email
	}

	// 更新密码
	if req.OldPassword != "" && req.NewPassword != "" {
		// 验证旧密码
		if !user.CheckPassword(req.OldPassword) {
			http.Error(w, "旧密码不正确", http.StatusBadRequest)
			return
		}
		// Validate password length
		if len(req.NewPassword) < 8 {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "Password must be at least 8 characters long"})
			return
		}
		// 设置新密码
		if err := user.SetPassword(req.NewPassword); err != nil {
			http.Error(w, "密码设置失败", http.StatusInternalServerError)
			return
		}
	}

	// 保存更新
	if err := h.userRepo.Update(user); err != nil {
		http.Error(w, "更新用户信息失败", http.StatusInternalServerError)
		return
	}

	// 记录活动
	ipAddress := r.Header.Get("X-Real-IP")
	if ipAddress == "" {
		ipAddress = r.Header.Get("X-Forwarded-For")
		if ipAddress == "" {
			ipAddress = r.RemoteAddr
		}
	}
	h.activityLogger.LogUserActivity("user.update", user, ipAddress)

	// 返回更新后的用户信息
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(user)
}

// isValidBase64Image 验证字符串是否为有效的base64编码图片
func isValidBase64Image(data string) bool {
	// 检查是否以数据URL格式开头
	if !strings.HasPrefix(data, "data:image/") {
		return false
	}

	// 提取base64部分
	parts := strings.Split(data, ";base64,")
	if len(parts) != 2 {
		return false
	}

	// 验证图片MIME类型
	mimeType := parts[0][5:] // 移除"data:"前缀
	validMimeTypes := map[string]bool{
		"image/jpeg":    true,
		"image/png":     true,
		"image/gif":     true,
		"image/webp":    true,
		"image/svg+xml": true,
	}
	if !validMimeTypes[mimeType] {
		return false
	}

	// 尝试解码base64内容
	base64Content := parts[1]
	_, err := base64.StdEncoding.DecodeString(base64Content)
	return err == nil
}
