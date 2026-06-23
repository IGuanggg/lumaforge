package model

import "encoding/json"

// CanvasProject stores a user's persisted canvas snapshot.
type CanvasProject struct {
	ID               string  `json:"id" gorm:"primaryKey"`
	UserID           string  `json:"userId" gorm:"primaryKey;index:idx_canvas_user_updated,priority:1;index:idx_canvas_user_deleted,priority:1"`
	Title            string  `json:"title"`
	NodesJSON        string  `json:"-" gorm:"column:nodes;type:text"`
	ConnectionsJSON  string  `json:"-" gorm:"column:connections;type:text"`
	ChatSessionsJSON string  `json:"-" gorm:"column:chat_sessions;type:text"`
	ActiveChatID     string  `json:"activeChatId"`
	BackgroundMode   string  `json:"backgroundMode"`
	ShowImageInfo    bool    `json:"showImageInfo"`
	ViewportJSON     string  `json:"-" gorm:"column:viewport;type:text"`
	MetadataJSON     string  `json:"-" gorm:"column:metadata;type:text"`
	ClientUpdatedAt  string  `json:"clientUpdatedAt" gorm:"index:idx_canvas_user_updated,priority:2"`
	Version          int64   `json:"version"`
	CreatedAt        string  `json:"createdAt"`
	UpdatedAt        string  `json:"updatedAt" gorm:"index:idx_canvas_user_updated,priority:3"`
	DeletedAt        *string `json:"deletedAt,omitempty" gorm:"index:idx_canvas_user_deleted,priority:2"`
}

// CanvasProjectPayload is the API representation used by the React canvas.
type CanvasProjectPayload struct {
	ID              string          `json:"id"`
	Title           string          `json:"title"`
	Nodes           json.RawMessage `json:"nodes"`
	Connections     json.RawMessage `json:"connections"`
	ChatSessions    json.RawMessage `json:"chatSessions"`
	ActiveChatID    string          `json:"activeChatId"`
	BackgroundMode  string          `json:"backgroundMode"`
	ShowImageInfo   bool            `json:"showImageInfo"`
	Viewport        json.RawMessage `json:"viewport"`
	Metadata        json.RawMessage `json:"metadata,omitempty"`
	ClientUpdatedAt string          `json:"clientUpdatedAt,omitempty"`
	Version         int64           `json:"version"`
	CreatedAt       string          `json:"createdAt"`
	UpdatedAt       string          `json:"updatedAt"`
	DeletedAt       *string         `json:"deletedAt,omitempty"`
}

// CanvasProjectList is a paginated cloud canvas snapshot.
type CanvasProjectList struct {
	Items []CanvasProjectPayload `json:"items"`
	Total int                    `json:"total"`
}
