package handler

// UserError describes a safe, actionable error that can be shown in the UI.
type UserError struct {
	Code    string
	Message string
	Action  string
}

func (e *UserError) Error() string       { return e.Message }
func (e *UserError) SafeMessage() string { return e.Message }

var (
	ErrLoginRequired = &UserError{
		Code:    "AUTH_LOGIN_REQUIRED",
		Message: "请先登录后再继续",
		Action:  "前往登录页面",
	}
	ErrCloudUnavailable = &UserError{
		Code:    "CLOUD_UNAVAILABLE",
		Message: "暂时无法连接云端服务，请检查网络后重试",
		Action:  "检查网络连接",
	}
	ErrProviderUnavailable = &UserError{
		Code:    "API_PROVIDER_UNAVAILABLE",
		Message: "当前 API 平台暂不可用，请检查平台地址、Key 和模型配置",
		Action:  "前往 API 设置",
	}
)
