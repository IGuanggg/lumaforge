package service

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/IGuanggg/lumaforge/model"
	"github.com/IGuanggg/lumaforge/repository"
)

const maxCanvasJSONBytes = 16 << 20

var errInvalidCanvas = errors.New("invalid canvas project")

// ListCanvasProjects returns a user's cloud canvases and deletion tombstones.
func ListCanvasProjects(userID string, offset int, limit int, includeDeleted bool) (model.CanvasProjectList, error) {
	if offset < 0 {
		offset = 0
	}
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	items, total, err := repository.ListCanvasProjects(userID, offset, limit, includeDeleted)
	if err != nil {
		return model.CanvasProjectList{}, err
	}
	payloads := make([]model.CanvasProjectPayload, 0, len(items))
	for _, item := range items {
		payloads = append(payloads, canvasProjectPayload(item))
	}
	return model.CanvasProjectList{Items: payloads, Total: int(total)}, nil
}

// GetCanvasProject returns a single user-owned canvas.
func GetCanvasProject(userID string, id string) (model.CanvasProjectPayload, bool, error) {
	item, ok, err := repository.FindCanvasProject(strings.TrimSpace(id), userID)
	if err != nil || !ok {
		return model.CanvasProjectPayload{}, ok, err
	}
	return canvasProjectPayload(item), true, nil
}

// SyncCanvasProject applies a last-writer-wins canvas update.
func SyncCanvasProject(userID string, payload model.CanvasProjectPayload) (model.CanvasProjectPayload, error) {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(payload.ID) == "" || len(payload.ID) > 160 {
		return model.CanvasProjectPayload{}, errInvalidCanvas
	}
	nodes, err := normalizeCanvasJSON(payload.Nodes, []byte("[]"))
	if err != nil {
		return model.CanvasProjectPayload{}, err
	}
	connections, err := normalizeCanvasJSON(payload.Connections, []byte("[]"))
	if err != nil {
		return model.CanvasProjectPayload{}, err
	}
	chatSessions, err := normalizeCanvasJSON(payload.ChatSessions, []byte("[]"))
	if err != nil {
		return model.CanvasProjectPayload{}, err
	}
	viewport, err := normalizeCanvasJSON(payload.Viewport, []byte(`{"x":0,"y":0,"k":1}`))
	if err != nil {
		return model.CanvasProjectPayload{}, err
	}
	metadata, err := normalizeCanvasJSON(payload.Metadata, []byte("{}"))
	if err != nil {
		return model.CanvasProjectPayload{}, err
	}

	now := time.Now().UTC()
	clientTime := firstCanvasTime(payload.ClientUpdatedAt, payload.UpdatedAt)
	if clientTime.IsZero() {
		clientTime = now
	}
	existing, found, err := repository.FindCanvasProject(payload.ID, userID)
	if err != nil {
		return model.CanvasProjectPayload{}, err
	}
	if found {
		existingClientTime := firstCanvasTime(existing.ClientUpdatedAt, existing.UpdatedAt)
		if !clientTime.After(existingClientTime) {
			return canvasProjectPayload(existing), nil
		}
	}

	createdAt := payload.CreatedAt
	version := int64(1)
	if found {
		createdAt = existing.CreatedAt
		version = existing.Version + 1
	}
	if strings.TrimSpace(createdAt) == "" {
		createdAt = now.Format(time.RFC3339Nano)
	}
	title := strings.TrimSpace(payload.Title)
	if title == "" {
		title = "未命名画布"
	}
	item := model.CanvasProject{
		ID:               strings.TrimSpace(payload.ID),
		UserID:           userID,
		Title:            title,
		NodesJSON:        string(nodes),
		ConnectionsJSON:  string(connections),
		ChatSessionsJSON: string(chatSessions),
		ActiveChatID:     strings.TrimSpace(payload.ActiveChatID),
		BackgroundMode:   firstNonEmptyString(strings.TrimSpace(payload.BackgroundMode), "lines"),
		ShowImageInfo:    payload.ShowImageInfo,
		ViewportJSON:     string(viewport),
		MetadataJSON:     string(metadata),
		ClientUpdatedAt:  clientTime.Format(time.RFC3339Nano),
		Version:          version,
		CreatedAt:        createdAt,
		UpdatedAt:        now.Format(time.RFC3339Nano),
		DeletedAt:        nil,
	}
	saved, err := repository.SaveCanvasProject(item)
	if err != nil {
		return model.CanvasProjectPayload{}, err
	}
	return canvasProjectPayload(saved), nil
}

// DeleteCanvasProject marks one user-owned canvas as deleted.
func DeleteCanvasProject(userID string, id string) (model.CanvasProjectPayload, bool, error) {
	item, ok, err := repository.FindCanvasProject(strings.TrimSpace(id), userID)
	if err != nil || !ok {
		return model.CanvasProjectPayload{}, ok, err
	}
	if item.DeletedAt == nil {
		now := time.Now().UTC().Format(time.RFC3339Nano)
		item.DeletedAt = &now
		item.ClientUpdatedAt = now
		item.UpdatedAt = now
		item.Version++
		item, err = repository.DeleteCanvasProject(item)
		if err != nil {
			return model.CanvasProjectPayload{}, false, err
		}
	}
	return canvasProjectPayload(item), true, nil
}

// ListCloudCanvasProjects reads the authoritative cross-device canvas snapshot.
func ListCloudCanvasProjects(token string) (model.CanvasProjectList, error) {
	baseURL, _, err := lumaCloudBaseURL(LumaLoadCloudSession().BaseURL)
	if err != nil {
		return model.CanvasProjectList{}, err
	}
	data, _, err := lumaCloudJSON(http.MethodGet, baseURL, "/api/canvases?offset=0&limit=500&include_deleted=true", token, nil)
	if err != nil {
		return model.CanvasProjectList{}, err
	}
	raw, err := json.Marshal(data)
	if err != nil {
		return model.CanvasProjectList{}, err
	}
	result := model.CanvasProjectList{}
	if err := json.Unmarshal(raw, &result); err != nil {
		return model.CanvasProjectList{}, err
	}
	return result, nil
}

// SyncCloudCanvasProject writes one snapshot to the configured cloud service.
func SyncCloudCanvasProject(token string, payload model.CanvasProjectPayload) (model.CanvasProjectPayload, error) {
	baseURL, _, err := lumaCloudBaseURL(LumaLoadCloudSession().BaseURL)
	if err != nil {
		return model.CanvasProjectPayload{}, err
	}
	data, _, err := lumaCloudJSON(http.MethodPost, baseURL, "/api/canvases", token, payload)
	if err != nil {
		return model.CanvasProjectPayload{}, err
	}
	raw, err := json.Marshal(data)
	if err != nil {
		return model.CanvasProjectPayload{}, err
	}
	result := model.CanvasProjectPayload{}
	if err := json.Unmarshal(raw, &result); err != nil {
		return model.CanvasProjectPayload{}, err
	}
	return result, nil
}

// DeleteCloudCanvasProject mirrors a deletion tombstone to the cloud service.
func DeleteCloudCanvasProject(token string, id string) error {
	baseURL, _, err := lumaCloudBaseURL(LumaLoadCloudSession().BaseURL)
	if err != nil {
		return err
	}
	_, _, err = lumaCloudJSON(http.MethodDelete, baseURL, "/api/canvases/"+url.PathEscape(id), token, nil)
	return err
}

func normalizeCanvasJSON(value json.RawMessage, fallback []byte) ([]byte, error) {
	trimmed := bytes.TrimSpace(value)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return fallback, nil
	}
	if len(trimmed) > maxCanvasJSONBytes || !json.Valid(trimmed) {
		return nil, errInvalidCanvas
	}
	return trimmed, nil
}

func canvasProjectPayload(item model.CanvasProject) model.CanvasProjectPayload {
	return model.CanvasProjectPayload{
		ID:              item.ID,
		Title:           item.Title,
		Nodes:           canvasRawJSON(item.NodesJSON, "[]"),
		Connections:     canvasRawJSON(item.ConnectionsJSON, "[]"),
		ChatSessions:    canvasRawJSON(item.ChatSessionsJSON, "[]"),
		ActiveChatID:    item.ActiveChatID,
		BackgroundMode:  item.BackgroundMode,
		ShowImageInfo:   item.ShowImageInfo,
		Viewport:        canvasRawJSON(item.ViewportJSON, `{"x":0,"y":0,"k":1}`),
		Metadata:        canvasRawJSON(item.MetadataJSON, "{}"),
		ClientUpdatedAt: item.ClientUpdatedAt,
		Version:         item.Version,
		CreatedAt:       item.CreatedAt,
		UpdatedAt:       item.UpdatedAt,
		DeletedAt:       item.DeletedAt,
	}
}

func canvasRawJSON(value string, fallback string) json.RawMessage {
	value = strings.TrimSpace(value)
	if value == "" || !json.Valid([]byte(value)) {
		value = fallback
	}
	return json.RawMessage(value)
}

func firstCanvasTime(values ...string) time.Time {
	for _, value := range values {
		if parsed, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(value)); err == nil {
			return parsed
		}
	}
	return time.Time{}
}
