# 任务 6：API Key 安全存储 [P1]

## 背景
当前 API Key 以明文形式存储在 `api_provider_keys.json` 文件中，存在安全风险：
- 文件权限控制不足
- 备份文件可能泄露密钥
- 跨设备同步时密钥暴露

## 任务目标
使用操作系统原生密钥管理器存储 API Key，提供安全且用户友好的密钥管理。

## 技术方案

### 跨平台密钥存储接口

```go
// service/keystore.go
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
    return NewFileKeyStore() // 降级
  }
}
```

### 平台实现

#### Windows - Credential Manager
使用库：`github.com/danieljoos/wincred`

```go
// service/keystore_windows.go
type WindowsKeyStore struct{}

func (s *WindowsKeyStore) Set(providerID string, apiKey string) error {
  cred := wincred.NewGenericCredential("LumaForge_API_Key_" + providerID)
  cred.CredentialBlob = []byte(apiKey)
  return cred.Write()
}
```

#### macOS - Keychain
使用库：`github.com/keybase/go-keychain`

```go
// service/keystore_darwin.go
type MacOSKeyStore struct{}

func (s *MacOSKeyStore) Set(providerID string, apiKey string) error {
  item := keychain.NewItem()
  item.SetSecClass(keychain.SecClassGenericPassword)
  item.SetService("LumaForge")
  item.SetAccount("api_key_" + providerID)
  item.SetData([]byte(apiKey))
  return keychain.AddItem(item)
}
```

#### 降级实现 - 文件存储
```go
// service/keystore_file.go
type FileKeyStore struct {
  path string
}

func (s *FileKeyStore) Set(providerID string, apiKey string) error {
  keys := s.load()
  keys[providerID] = apiKey
  return s.save(keys)
}
```

### 迁移逻辑

```go
// service/keystore_migration.go
func MigrateKeysToSecureStore() error {
  store := NewSecureKeyStore()
  
  // 如果不可用，跳过迁移
  if !store.IsAvailable() {
    return nil
  }
  
  // 读取旧 JSON 文件
  oldFile := "data/api_provider_keys.json"
  data, _ := os.ReadFile(oldFile)
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

### 更新密钥加载逻辑

```go
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

### 用户界面提示

```typescript
// web/src/app/(user)/api-settings/page.tsx
export function APISettingsPage() {
  const [keyStoreStatus, setKeyStoreStatus] = useState<{
    type: 'system' | 'file';
  }>();
  
  return (
    <div>
      {keyStoreStatus?.type === 'system' && (
        <Alert>
          <ShieldCheck className="h-4 w-4" />
          <AlertTitle>安全存储已启用</AlertTitle>
          <AlertDescription>
            您的 API 密钥使用系统密钥管理器安全存储，不会以明文保存。
          </AlertDescription>
        </Alert>
      )}
      
      {keyStoreStatus?.type === 'file' && (
        <Alert variant="warning">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>降级存储模式</AlertTitle>
          <AlertDescription>
            当前系统不支持安全密钥存储，密钥将保存在本地文件中。
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
```

## 输出清单
- [ ] `SecureKeyStore` 接口定义
- [ ] Windows Credential Manager 实现
- [ ] macOS Keychain 实现
- [ ] 文件存储降级实现
- [ ] 密钥迁移脚本
- [ ] 更新的密钥加载逻辑
- [ ] 前端状态提示组件
- [ ] 单元测试（各平台）
- [ ] 迁移验证测试

## 验收标准
- [ ] Windows/macOS 上密钥存储在系统密钥管理器
- [ ] 旧 JSON 文件自动迁移
- [ ] 降级方案正常工作
- [ ] 用户界面显示安全状态
- [ ] 测试覆盖率 > 80%
- [ ] 旧用户无感升级

## 预计工作量
3-4 天
