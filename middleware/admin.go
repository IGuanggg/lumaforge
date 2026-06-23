package middleware

import (
	"net/http"
	"strings"

	"github.com/IGuanggg/lumaforge/handler"
	"github.com/IGuanggg/lumaforge/model"
	"github.com/IGuanggg/lumaforge/service"
	"github.com/gin-gonic/gin"
)

const lumaAuthCookieName = "lumaforge_auth_token"

func AdminAuth(c *gin.Context) {
	user, ok := authUser(c)
	if !ok || user.Role != model.UserRoleAdmin {
		handler.Fail(c.Writer, "未登录或权限不足")
		c.Abort()
		return
	}
	c.Request = c.Request.WithContext(service.WithUser(c.Request.Context(), user))
	c.Next()
}

func UserAuth(c *gin.Context) {
	user, ok := authUser(c)
	if !ok || user.Role == model.UserRoleGuest {
		handler.Fail(c.Writer, "未登录或权限不足")
		c.Abort()
		return
	}
	c.Request = c.Request.WithContext(service.WithUser(c.Request.Context(), user))
	c.Next()
}

func OptionalAuth(c *gin.Context) {
	if user, ok := authUser(c); ok {
		c.Request = c.Request.WithContext(service.WithUser(c.Request.Context(), user))
	}
	c.Next()
}

func NotFoundJSON(c *gin.Context) {
	c.JSON(http.StatusNotFound, gin.H{"code": 1, "data": nil, "msg": "接口不存在"})
}

func authUser(c *gin.Context) (model.AuthUser, bool) {
	token := strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer ")
	if strings.TrimSpace(token) == "" {
		if cookieToken, err := c.Cookie(lumaAuthCookieName); err == nil {
			token = cookieToken
		}
	}
	if strings.TrimSpace(token) == "" {
		token = service.LumaLoadCloudSession().Token
	}
	if strings.TrimSpace(token) == "" {
		return model.AuthUser{}, false
	}
	if user, ok := service.LumaCurrentAuthUser(token); ok {
		return user, true
	}
	return service.CurrentAuthUser(token)
}
