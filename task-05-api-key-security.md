# 任务 5：API Key 安全存储 [P1]

> 状态：不执行（2026-06-22）。根据产品决定，API Key 继续明文保存到 `api_provider_keys.json`，不接入系统凭据库或加密文件。诊断接口明确返回 `key_storage_mode: plaintext-json`。

## 🔐 核心问题

**当前状况**：API Key 明文存储

```bash
# data/api_provider_keys.json
{
  "openai": "sk-xxxxxxxxxxxxxxxx",
  "anthropic": "sk-ant-xxxxxxxxxxxxxxxx"
}
```

**风险**：
- ❌ 文件泄露 = 密钥泄露
- ❌ 备份文件包含明文密钥
- ❌ 云同步可能暴露密钥

---

## 🎯 解决方案

### 跨平台密钥管理

| 平台 | 存储方式 | Go 库 |
|------|---------|-------|
| Windows | Credential Manager | `github.com/danieljoos/wincred` |
| macOS | Keychain | `github.com/keybase/go-keychain` |
| Linux/其他 | 加密文件（降级） | AES-256 + 用户密钥 |

---

## 📋 具体任务

### 5.1 密钥存储接口

```go
// service/keystore.go

package service

import "runtime"

type SecureKeyStore interface {
	Set(providerID string, apiKey string) error
	Get(providerID string) (string, error)
	Delete(providerID string) error
	List() ([]string, error)
	IsAvailable() bool
}

func NewSecureKeyStore() SecureKeyStore {
	switch runtime.GOOS {
	case "windows":
		return NewWindowsKeyStore()
	case "darwin":
		return NewMacOSKeyStore()
	default:
		return NewFileKeyStore() // 加密文件存储
	}
}
```

### 5.2 Windows 实现

```go
// service/keystore_windows.go
// +build windows

package service

import "github.com/danieljoos/wincred"

const keyStoreTarget = "LumaForge_API_Key_"

type WindowsKeyStore struct{}

func NewWindowsKeyStore() *WindowsKeyStore {
	return &WindowsKeyStore{}
}

func (s *WindowsKeyStore) Set(providerID string, apiKey string) error {
	cred := wincred.NewGenericCredential(keyStoreTarget + providerID)
	cred.CredentialBlob = []byte(apiKey)
	return cred.Write()
}

func (s *WindowsKeyStore) Get(providerID string) (string, error) {
	cred, err := wincred.GetGenericCredential(keyStoreTarget + providerID)
	if err != nil {
		return "", err
	}
	return string(cred.CredentialBlob), nil
}

func (s *WindowsKeyStore) Delete(providerID string) error {
	cred, err := wincred.GetGenericCredential(keyStoreTarget + providerID)
	if err != nil {
		return err
	}
	return cred.Delete()
}

func (s *WindowsKeyStore) IsAvailable() bool {
	return true
}
```

### 5.3 macOS 实现

```go
// service/keystore_darwin.go
// +build darwin

package service

import "github.com/keybase/go-keychain"

type MacOSKeyStore struct{}

func (s *MacOSKeyStore) Set(providerID string, apiKey string) error {
	item := keychain.NewItem()
	item.SetSecClass(keychain.SecClassGenericPassword)
	item.SetService("LumaForge")
	item.SetAccount("api_key_" + providerID)
	item.SetData([]byte(apiKey))
	return keychain.AddItem(item)
}

// ... 其他方法类似
```

### 5.4 迁移旧密钥

```go
// service/keystore_migration.go

func MigrateKeysToSecureStore() error {
	store := NewSecureKeyStore()
	
	if !store.IsAvailable() {
		return nil // 跳过
	}
	
	// 读取旧 JSON
	oldFile := "data/api_provider_keys.json"
	data, err := os.ReadFile(oldFile)
	if err != nil {
		return nil // 文件不存在
	}
	
	var oldKeys map[string]string
	json.Unmarshal(data, &oldKeys)
	
	// 迁移到系统密钥管理器
	for providerID, apiKey := range oldKeys {
		store.Set(providerID, apiKey)
	}
	
	// 备份旧文件
	os.Rename(oldFile, oldFile+".backup")
	
	return nil
}
```

### 5.5 更新密钥加载

```go
// service/lumaforge.go

func LumaLoadProviderKeys() map[string]string {
	store := NewSecureKeyStore()
	
	providerIDs, _ := store.List()
	keys := map[string]string{}
	
	for _, id := range providerIDs {
		key, _ := store.Get(id)
		keys[id] = key
	}
	
	return keys
}
```

---

## ✅ 验收标准

- [ ] Windows 上密钥存 Credential Manager
- [ ] macOS 上密钥存 Keychain
- [ ] 旧 JSON 文件自动迁移
- [ ] 降级方案正常工作
- [ ] 前端显示安全状态提示

---

## ⏱️ 预计工作量

**3-4 天**
