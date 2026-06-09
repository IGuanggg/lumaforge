package service

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/basketikun/infinite-canvas/config"
)

const LumaMigrationReportName = "migration-2.1.0.json"

func LumaMigrationStatus() map[string]any {
	report := map[string]any{}
	reportExists := readJSONFile(lumaPath(LumaMigrationReportName), &report)
	return map[string]any{
		"ok":              true,
		"report_exists":   reportExists,
		"report":          report,
		"legacy_api_url":  strings.TrimRight(config.Cfg.LumaForgeLegacyAPI, "/"),
		"data_dir":        LumaDataDir(),
		"assets_dir":      LumaAssetsDir(),
		"providers_count": len(LumaLoadProviders()),
		"cloud_logged_in": LumaLoadCloudSession().Token != "",
	}
}

func LumaMigrationImport() map[string]any {
	now := time.Now().UTC().Format(time.RFC3339)
	report := map[string]any{
		"ok":              true,
		"started_at":      now,
		"completed_at":    now,
		"legacy_api_url":  strings.TrimRight(config.Cfg.LumaForgeLegacyAPI, "/"),
		"providers_count": len(LumaLoadProviders()),
		"cloud_logged_in": LumaLoadCloudSession().Token != "",
		"projects_count":  0,
		"assets_count":    0,
		"errors":          []string{},
	}
	projects := []map[string]any{}
	assets := []map[string]any{}
	errors := []string{}

	if strings.TrimSpace(config.Cfg.LumaForgeLegacyAPI) == "" {
		errors = append(errors, "未连接 legacy compatibility API，跳过旧画布和旧素材导入。")
	} else {
		if data, err := lumaLegacyJSON("/api/canvases"); err == nil {
			for _, item := range anySlice(firstNonNil(data["canvases"], data["items"])) {
				if project := convertLegacyCanvasProject(legacyCanvasDetail(anyMap(item))); project != nil {
					projects = append(projects, project)
				}
			}
		} else {
			errors = append(errors, "读取旧画布失败："+err.Error())
		}
		if data, err := lumaLegacyJSON("/api/assets?limit=200"); err == nil {
			for _, item := range anySlice(firstNonNil(data["items"], data["assets"])) {
				if asset := normalizeLegacyAsset(anyMap(item)); asset != nil {
					assets = append(assets, asset)
				}
			}
		} else {
			errors = append(errors, "读取旧素材失败："+err.Error())
		}
	}

	report["projects_count"] = len(projects)
	report["assets_count"] = len(assets)
	report["errors"] = errors
	if len(errors) > 0 {
		report["ok"] = false
	}
	_ = writeJSONFile(lumaPath(LumaMigrationReportName), report)
	return map[string]any{
		"ok":       len(errors) == 0,
		"report":   report,
		"projects": projects,
		"assets":   assets,
		"errors":   errors,
	}
}

func lumaLegacyJSON(path string) (map[string]any, error) {
	baseURL := strings.TrimRight(strings.TrimSpace(config.Cfg.LumaForgeLegacyAPI), "/")
	if baseURL == "" {
		return nil, fmt.Errorf("legacy API 未配置")
	}
	request, err := http.NewRequest(http.MethodGet, baseURL+path, nil)
	if err != nil {
		return nil, err
	}
	response, err := lumaHTTPClient.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(response.Body, 16<<20))
	if response.StatusCode >= http.StatusBadRequest {
		return nil, fmt.Errorf("legacy API %s 返回 %d", path, response.StatusCode)
	}
	var result map[string]any
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, err
	}
	return result, nil
}

func LumaLegacyJSON(path string) (map[string]any, error) {
	return lumaLegacyJSON(path)
}

func legacyCanvasDetail(canvas map[string]any) map[string]any {
	if len(canvas) == 0 {
		return canvas
	}
	if len(anySlice(canvas["nodes"])) > 0 || len(anySlice(canvas["connections"])) > 0 {
		return canvas
	}
	id := stringFromAny(canvas["id"])
	if id == "" {
		return canvas
	}
	data, err := lumaLegacyJSON("/api/canvases/" + url.PathEscape(id))
	if err != nil {
		return canvas
	}
	detail := anyMap(firstNonNil(data["canvas"], data["project"], data))
	if len(detail) == 0 {
		return canvas
	}
	return detail
}

func convertLegacyCanvasProject(canvas map[string]any) map[string]any {
	if len(canvas) == 0 {
		return nil
	}
	legacyID := stringFromAny(canvas["id"])
	now := time.Now().UTC().Format(time.RFC3339)
	nodes := []map[string]any{}
	for _, item := range anySlice(canvas["nodes"]) {
		if node := convertLegacyCanvasNode(anyMap(item)); node != nil {
			nodes = append(nodes, node)
		}
	}
	connections := []map[string]any{}
	for _, item := range anySlice(canvas["connections"]) {
		if conn := convertLegacyCanvasConnection(anyMap(item)); conn != nil {
			connections = append(connections, conn)
		}
	}
	return map[string]any{
		"id":             "legacy-" + firstNonEmptyString(legacyID, newID("canvas")),
		"title":          firstNonEmptyString(stringFromAny(canvas["title"]), "旧版画布"),
		"createdAt":      timeFromAny(firstNonNil(canvas["created_at"], canvas["createdAt"]), now),
		"updatedAt":      timeFromAny(firstNonNil(canvas["updated_at"], canvas["updatedAt"]), now),
		"nodes":          nodes,
		"connections":    connections,
		"chatSessions":   []any{},
		"activeChatId":   nil,
		"backgroundMode": firstNonEmptyString(stringFromAny(canvas["backgroundMode"]), "lines"),
		"showImageInfo":  false,
		"viewport":       normalizeLegacyViewport(anyMap(canvas["viewport"])),
		"metadata": map[string]any{
			"legacyId":   legacyID,
			"source":     "legacy-v2.0",
			"migratedAt": now,
			"legacyKind": stringFromAny(canvas["kind"]),
		},
	}
}

func convertLegacyCanvasNode(node map[string]any) map[string]any {
	if len(node) == 0 {
		return nil
	}
	legacyType := strings.ToLower(firstNonEmptyString(stringFromAny(node["type"]), stringFromAny(node["kind"])))
	nodeType := "image"
	if strings.Contains(legacyType, "text") || strings.Contains(legacyType, "prompt") {
		nodeType = "text"
	} else if strings.Contains(legacyType, "video") {
		nodeType = "video"
	}
	content := legacyNodeContent(node, nodeType)
	prompt := firstNonEmptyString(
		stringFromAny(node["promptDraftText"]),
		stringFromAny(node["runPrompt"]),
		stringFromAny(node["prompt"]),
		stringFromAny(node["text"]),
	)
	width := numberFromAny(firstNonNil(node["width"], node["w"]), 320)
	height := numberFromAny(firstNonNil(node["height"], node["h"]), 220)
	if nodeType == "text" {
		width = numberFromAny(firstNonNil(node["width"], node["w"]), 360)
		height = numberFromAny(firstNonNil(node["height"], node["h"]), 220)
	}
	return map[string]any{
		"id":    firstNonEmptyString(stringFromAny(node["id"]), newID("node")),
		"type":  nodeType,
		"title": firstNonEmptyString(stringFromAny(node["title"]), stringFromAny(node["name"]), "旧版节点"),
		"position": map[string]any{
			"x": numberFromAny(firstNonNil(node["x"], anyMap(node["position"])["x"]), 0),
			"y": numberFromAny(firstNonNil(node["y"], anyMap(node["position"])["y"]), 0),
		},
		"width":  width,
		"height": height,
		"metadata": map[string]any{
			"content":   content,
			"prompt":    prompt,
			"status":    firstNonEmptyString(stringFromAny(node["status"]), "idle"),
			"model":     firstNonEmptyString(stringFromAny(node["model"]), stringFromAny(anyMap(node["runSettings"])["model"])),
			"size":      firstNonEmptyString(stringFromAny(node["size"]), stringFromAny(anyMap(node["runSettings"])["size"])),
			"quality":   firstNonEmptyString(stringFromAny(node["quality"]), stringFromAny(anyMap(node["runSettings"])["quality"])),
			"legacyRaw": node,
		},
	}
}

func convertLegacyCanvasConnection(conn map[string]any) map[string]any {
	from := firstNonEmptyString(stringFromAny(conn["fromNodeId"]), stringFromAny(conn["from"]))
	to := firstNonEmptyString(stringFromAny(conn["toNodeId"]), stringFromAny(conn["to"]))
	if from == "" || to == "" {
		return nil
	}
	return map[string]any{
		"id":         firstNonEmptyString(stringFromAny(conn["id"]), newID("conn")),
		"fromNodeId": from,
		"toNodeId":   to,
	}
}

func normalizeLegacyAsset(asset map[string]any) map[string]any {
	if len(asset) == 0 {
		return nil
	}
	url := firstNonEmptyString(stringFromAny(asset["url"]), stringFromAny(asset["local_url"]), stringFromAny(asset["source_url"]))
	coverURL := firstNonEmptyString(stringFromAny(asset["coverUrl"]), stringFromAny(asset["thumb_url"]), url)
	kind := strings.ToLower(firstNonEmptyString(stringFromAny(asset["type"]), "image"))
	if kind != "video" && kind != "text" {
		kind = "image"
	}
	return map[string]any{
		"id":          firstNonEmptyString(stringFromAny(asset["id"]), newID("asset")),
		"title":       firstNonEmptyString(stringFromAny(asset["title"]), stringFromAny(asset["name"]), "旧版素材"),
		"type":        kind,
		"coverUrl":    coverURL,
		"tags":        anyStringSlice(asset["tags"]),
		"category":    firstNonEmptyString(stringFromAny(asset["category"]), stringFromAny(asset["category_id"]), "inbox"),
		"description": firstNonEmptyString(stringFromAny(asset["description"]), stringFromAny(asset["prompt"])),
		"content":     firstNonEmptyString(stringFromAny(asset["content"]), stringFromAny(asset["prompt"])),
		"url":         url,
		"createdAt":   timeFromAny(firstNonNil(asset["createdAt"], asset["created_at"]), time.Now().UTC().Format(time.RFC3339)),
		"updatedAt":   timeFromAny(firstNonNil(asset["updatedAt"], asset["updated_at"]), time.Now().UTC().Format(time.RFC3339)),
	}
}

func legacyNodeContent(node map[string]any, nodeType string) string {
	if nodeType == "text" {
		return firstNonEmptyString(stringFromAny(node["content"]), stringFromAny(node["text"]), stringFromAny(node["prompt"]), stringFromAny(node["promptDraftText"]))
	}
	for _, image := range anySlice(node["images"]) {
		if url := firstNonEmptyString(stringFromAny(anyMap(image)["url"]), stringFromAny(anyMap(image)["local_url"])); url != "" {
			return url
		}
	}
	return firstNonEmptyString(stringFromAny(node["content"]), stringFromAny(node["url"]), stringFromAny(node["local_url"]), stringFromAny(node["image"]))
}

func normalizeLegacyViewport(viewport map[string]any) map[string]any {
	return map[string]any{
		"x": numberFromAny(viewport["x"], 0),
		"y": numberFromAny(viewport["y"], 0),
		"k": numberFromAny(firstNonNil(viewport["k"], viewport["scale"]), 1),
	}
}

func anyMap(value any) map[string]any {
	if value == nil {
		return map[string]any{}
	}
	if result, ok := value.(map[string]any); ok {
		return result
	}
	return map[string]any{}
}

func anySlice(value any) []any {
	if value == nil {
		return nil
	}
	if result, ok := value.([]any); ok {
		return result
	}
	return nil
}

func anyStringSlice(value any) []string {
	result := []string{}
	for _, item := range anySlice(value) {
		if text := strings.TrimSpace(stringFromAny(item)); text != "" {
			result = append(result, text)
		}
	}
	return result
}

func numberFromAny(value any, fallback float64) float64 {
	switch typed := value.(type) {
	case float64:
		return typed
	case float32:
		return float64(typed)
	case int:
		return float64(typed)
	case int64:
		return float64(typed)
	case json.Number:
		if parsed, err := typed.Float64(); err == nil {
			return parsed
		}
	case string:
		var parsed float64
		if _, err := fmt.Sscan(typed, &parsed); err == nil {
			return parsed
		}
	}
	return fallback
}

func timeFromAny(value any, fallback string) string {
	if text := strings.TrimSpace(stringFromAny(value)); text != "" {
		if _, err := time.Parse(time.RFC3339, text); err == nil {
			return text
		}
		var seconds float64
		if _, err := fmt.Sscan(text, &seconds); err == nil && seconds > 0 {
			return unixishTime(seconds)
		}
	}
	if n := numberFromAny(value, 0); n > 0 {
		return unixishTime(n)
	}
	return fallback
}

func unixishTime(value float64) string {
	if value > 100000000000 {
		return time.UnixMilli(int64(value)).UTC().Format(time.RFC3339)
	}
	return time.Unix(int64(value), 0).UTC().Format(time.RFC3339)
}

func WriteLumaMigrationReportForDesktop(migratedFrom []string) {
	if len(migratedFrom) == 0 {
		return
	}
	report := map[string]any{
		"ok":            true,
		"desktop_copy":  true,
		"migrated_from": migratedFrom,
		"completed_at":  time.Now().UTC().Format(time.RFC3339),
	}
	_ = os.MkdirAll(LumaDataDir(), 0755)
	_ = writeJSONFile(lumaPath(LumaMigrationReportName), report)
}
