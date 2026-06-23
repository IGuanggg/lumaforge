package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/IGuanggg/lumaforge/model"
	"github.com/IGuanggg/lumaforge/service"
)

var errLegacyAssetUnavailable = fmt.Errorf("旧素材库兼容接口需要 legacy compatibility API")

func Assets(w http.ResponseWriter, r *http.Request) {
	legacyPath := "/api/assets"
	if r.URL.RawQuery != "" {
		legacyPath += "?" + r.URL.RawQuery
	}
	if data, err := service.LumaLegacyJSON(legacyPath); err == nil {
		OK(w, data)
		return
	}
	result, err := service.ListAssets(parseQuery(r))
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

func AssetLegacyProxy(w http.ResponseWriter, r *http.Request) {
	if proxyLegacy(w, r) {
		return
	}
	writeRawError(w, http.StatusNotImplemented, errLegacyAssetUnavailable)
}

func AssetFile(w http.ResponseWriter, r *http.Request, assetPath string) {
	serveLocalStaticFile(w, r, service.LumaAssetsDir(), assetPath)
}

func OutputFile(w http.ResponseWriter, r *http.Request, outputPath string) {
	if serveLocalStaticFileMaybe(w, r, service.LumaOutputDir(), outputPath) {
		return
	}
	serveLocalStaticFile(w, r, filepath.Join(service.LumaDataDir(), "output"), outputPath)
}

func AdminAssets(w http.ResponseWriter, r *http.Request) {
	result, err := service.ListAssets(parseQuery(r))
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

func serveLocalStaticFile(w http.ResponseWriter, r *http.Request, root string, requestPath string) {
	if !serveLocalStaticFileMaybe(w, r, root, requestPath) {
		http.NotFound(w, r)
	}
}

func serveLocalStaticFileMaybe(w http.ResponseWriter, r *http.Request, root string, requestPath string) bool {
	root = strings.TrimSpace(root)
	if root == "" {
		return false
	}
	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return false
	}
	cleanPath := filepath.Clean(filepath.FromSlash(strings.TrimPrefix(requestPath, "/")))
	if cleanPath == "." || filepath.IsAbs(cleanPath) || strings.HasPrefix(cleanPath, ".."+string(os.PathSeparator)) || cleanPath == ".." {
		return false
	}
	targetAbs, err := filepath.Abs(filepath.Join(rootAbs, cleanPath))
	if err != nil {
		return false
	}
	rel, err := filepath.Rel(rootAbs, targetAbs)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) || filepath.IsAbs(rel) {
		return false
	}
	info, err := os.Stat(targetAbs)
	if err != nil || info.IsDir() {
		return false
	}
	http.ServeFile(w, r, targetAbs)
	return true
}

func AdminSaveAsset(w http.ResponseWriter, r *http.Request) {
	var item model.Asset
	_ = json.NewDecoder(r.Body).Decode(&item)
	result, err := service.SaveAsset(item)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

func AdminDeleteAsset(w http.ResponseWriter, r *http.Request, id string) {
	if err := service.DeleteAsset(id); err != nil {
		FailError(w, err)
		return
	}
	OK(w, true)
}
