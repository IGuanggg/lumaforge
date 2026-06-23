package handler

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/IGuanggg/lumaforge/model"
	"github.com/IGuanggg/lumaforge/service"
)

const maxCanvasRequestBytes = 20 << 20

// Canvases lists the current user's cloud canvas snapshots.
func Canvases(w http.ResponseWriter, r *http.Request) {
	user, ok := service.UserFromContext(r.Context())
	if !ok || strings.TrimSpace(user.ID) == "" {
		FailUser(w, ErrLoginRequired)
		return
	}
	query := r.URL.Query()
	offset, _ := strconv.Atoi(query.Get("offset"))
	limit, _ := strconv.Atoi(query.Get("limit"))
	includeDeleted := query.Get("includeDeleted") != "false"
	token := lumaAuthTokenFromRequest(r)
	if strings.TrimSpace(token) != "" {
		if cloud, err := service.ListCloudCanvasProjects(token); err == nil {
			OK(w, cloud)
			return
		}
	}
	result, err := service.ListCanvasProjects(user.ID, offset, limit, includeDeleted)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

// Canvas returns a user-owned canvas snapshot.
func Canvas(w http.ResponseWriter, r *http.Request, id string) {
	user, ok := service.UserFromContext(r.Context())
	if !ok || strings.TrimSpace(user.ID) == "" {
		FailUser(w, ErrLoginRequired)
		return
	}
	result, found, err := service.GetCanvasProject(user.ID, id)
	if err != nil {
		FailError(w, err)
		return
	}
	if !found {
		Fail(w, "画布不存在")
		return
	}
	OK(w, result)
}

// SaveCanvas synchronizes one local canvas snapshot to the cloud store.
func SaveCanvas(w http.ResponseWriter, r *http.Request) {
	user, ok := service.UserFromContext(r.Context())
	if !ok || strings.TrimSpace(user.ID) == "" {
		FailUser(w, ErrLoginRequired)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxCanvasRequestBytes)
	payload := model.CanvasProjectPayload{}
	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(&payload); err != nil {
		Fail(w, "画布数据格式不正确")
		return
	}
	result, err := service.SyncCanvasProject(user.ID, payload)
	if err != nil {
		Fail(w, "画布云端保存失败")
		return
	}
	if token := lumaAuthTokenFromRequest(r); strings.TrimSpace(token) != "" {
		cloud, cloudErr := service.SyncCloudCanvasProject(token, result)
		if cloudErr != nil {
			FailUser(w, &UserError{Code: ErrCloudUnavailable.Code, Message: "画布已安全保存在本机，云端将在网络恢复后继续同步", Action: ErrCloudUnavailable.Action})
			return
		}
		result = cloud
	}
	OK(w, result)
}

// DeleteCanvas stores a deletion tombstone for a user-owned canvas.
func DeleteCanvas(w http.ResponseWriter, r *http.Request, id string) {
	user, ok := service.UserFromContext(r.Context())
	if !ok || strings.TrimSpace(user.ID) == "" {
		FailUser(w, ErrLoginRequired)
		return
	}
	result, found, err := service.DeleteCanvasProject(user.ID, id)
	if err != nil {
		FailError(w, err)
		return
	}
	if !found {
		OK(w, map[string]any{"ok": true, "id": id})
		return
	}
	if token := lumaAuthTokenFromRequest(r); strings.TrimSpace(token) != "" {
		if cloudErr := service.DeleteCloudCanvasProject(token, id); cloudErr != nil {
			FailUser(w, &UserError{Code: ErrCloudUnavailable.Code, Message: "画布已从本机删除，云端将在网络恢复后继续同步", Action: ErrCloudUnavailable.Action})
			return
		}
	}
	OK(w, result)
}
