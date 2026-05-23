package api

import (
	"context"
	"mailman/internal/models"
	"mailman/internal/repository"
	"mailman/internal/utils"
	"net/http"
)

// 授权相关的 Context Key
const (
	OrgContextKey        ContextKey = "current_org"
	OrgMemberContextKey  ContextKey = "org_member"
	UserRoleContextKey   ContextKey = "user_role"
	PermissionsContextKey ContextKey = "permissions"
)

// AuthorizationContext 授权上下文，包含当前用户的组织和角色信息
type AuthorizationContext struct {
	User         *models.User
	Organization *models.Organization
	OrgMember    *models.OrgMember
	Role         *models.Role
	Permissions  []models.Permission
}

// OrgMiddleware 组织上下文中间件
// 从已认证的用户信息中加载其当前组织、角色和权限到 Context
func OrgMiddleware(
	orgRepo *repository.OrganizationRepository,
	memberRepo *repository.OrgMemberRepository,
	roleRepo *repository.RoleRepository,
) func(http.Handler) http.Handler {
	logger := utils.NewLogger("OrgMiddleware")

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// 获取已认证的用户
			user, ok := r.Context().Value(UserContextKey).(*models.User)
			if !ok || user == nil {
				http.Error(w, "User not authenticated", http.StatusUnauthorized)
				return
			}

			// 超级管理员始终拥有所有权限，但仍然需要加载组织上下文
			ctx := r.Context()

			// 如果用户有 CurrentOrgID，加载组织信息
			if user.CurrentOrgID != nil {
				org, err := orgRepo.GetByID(*user.CurrentOrgID)
				if err != nil {
					logger.Warn("User %d has invalid current_org_id %d: %v", user.ID, *user.CurrentOrgID, err)
					// 尝试获取用户的第一个组织
					orgs, _ := orgRepo.GetUserOrganizations(user.ID)
					if len(orgs) > 0 {
						org = &orgs[0]
					}
				}

				if org != nil {
					ctx = context.WithValue(ctx, OrgContextKey, org)

					// 加载用户在该组织中的成员关系和角色
					member, err := memberRepo.GetByOrgAndUser(org.ID, user.ID)
					if err == nil && member != nil {
						ctx = context.WithValue(ctx, OrgMemberContextKey, member)

						// 加载角色
						role, err := roleRepo.GetByID(member.RoleID)
						if err == nil && role != nil {
							ctx = context.WithValue(ctx, UserRoleContextKey, role)
						}

						// 加载权限
						permissions, err := roleRepo.GetRolePermissions(member.RoleID)
						if err == nil {
							ctx = context.WithValue(ctx, PermissionsContextKey, permissions)
						}
					}
				}
			} else {
				// 用户没有 CurrentOrgID，尝试设置默认组织
				orgs, _ := orgRepo.GetUserOrganizations(user.ID)
				if len(orgs) > 0 {
					ctx = context.WithValue(ctx, OrgContextKey, &orgs[0])

					member, err := memberRepo.GetByOrgAndUser(orgs[0].ID, user.ID)
					if err == nil && member != nil {
						ctx = context.WithValue(ctx, OrgMemberContextKey, member)

						role, err := roleRepo.GetByID(member.RoleID)
						if err == nil && role != nil {
							ctx = context.WithValue(ctx, UserRoleContextKey, role)
						}

						permissions, err := roleRepo.GetRolePermissions(member.RoleID)
						if err == nil {
							ctx = context.WithValue(ctx, PermissionsContextKey, permissions)
						}
					}
				}
			}

			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// RequirePermission 权限检查中间件工厂
// 返回一个中间件，检查当前用户是否拥有指定的 resource:action 权限
func RequirePermission(resource, action string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !CheckPermission(r, resource, action) {
				http.Error(w, "Insufficient permissions", http.StatusForbidden)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RequireSuperAdmin 超级管理员检查中间件
func RequireSuperAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, ok := r.Context().Value(UserContextKey).(*models.User)
		if !ok || user == nil || !user.IsSuperAdmin {
			http.Error(w, "Super admin access required", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// ---- Context 辅助函数 ----

// GetCurrentOrg 从 Context 获取当前组织
func GetCurrentOrg(r *http.Request) *models.Organization {
	org, ok := r.Context().Value(OrgContextKey).(*models.Organization)
	if !ok {
		return nil
	}
	return org
}

// GetCurrentOrgID 从 Context 获取当前组织ID
func GetCurrentOrgID(r *http.Request) uint {
	org := GetCurrentOrg(r)
	if org != nil {
		return org.ID
	}
	return 0
}

// GetCurrentUserRole 从 Context 获取当前用户角色
func GetCurrentUserRole(r *http.Request) *models.Role {
	role, ok := r.Context().Value(UserRoleContextKey).(*models.Role)
	if !ok {
		return nil
	}
	return role
}

// GetCurrentUser 从 Context 获取当前用户（增强版）
func GetCurrentUser(r *http.Request) *models.User {
	user, ok := r.Context().Value(UserContextKey).(*models.User)
	if !ok {
		return nil
	}
	return user
}

// CheckPermission 检查当前请求用户是否拥有指定权限
func CheckPermission(r *http.Request, resource, action string) bool {
	user := GetCurrentUser(r)
	if user == nil {
		return false
	}

	// 超级管理员拥有所有权限
	if user.IsSuperAdmin {
		return true
	}

	// 检查用户的权限列表
	permissions, ok := r.Context().Value(PermissionsContextKey).([]models.Permission)
	if !ok {
		return false
	}

	for _, p := range permissions {
		// manage 权限覆盖该资源的所有操作
		if p.Resource == resource && (p.Action == action || p.Action == models.ActionManage) {
			return true
		}
	}

	return false
}

// CheckPermissionHandler 权限检查的 HandlerFunc 包装器
// 用于在单个 handler 内部检查权限
func CheckPermissionOrForbid(w http.ResponseWriter, r *http.Request, resource, action string) bool {
	if !CheckPermission(r, resource, action) {
		http.Error(w, "Insufficient permissions", http.StatusForbidden)
		return false
	}
	return true
}
