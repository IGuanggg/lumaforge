# LumaForge 打包与部署

目标版本：`2.0.1`

## 桌面窗口版

```powershell
.\build_desktop.bat
```

产物：

```text
dist\LumaForge\LumaForge.exe
```

默认目录：

- Runtime: `%APPDATA%\LumaForge`
- Images: `%USERPROFILE%\Pictures\LumaForge`
- Logs: `%LOCALAPPDATA%\LumaForge\logs`

## 浏览器版 EXE

```powershell
.\build_windows.bat
```

产物：

```text
dist\LumaForge Browser\LumaForge.exe
```

浏览器版会自动选择端口、启动本地 FastAPI 服务并打开系统浏览器。数据在 EXE 旁边的 `userdata/`。

## 源码运行

```powershell
pip install -r requirements.txt
python launcher.py
```

## 云后端 Docker

服务名：`lumaforge-cloud`

镜像：`iguang9881/lumaforge-cloud`

持久化目录：`/opt/lumaforge-cloud/cloud-data`

```bash
mkdir -p /opt/lumaforge-cloud/cloud-data
cd /opt/lumaforge-cloud
docker pull iguang9881/lumaforge-cloud:2.0.1
docker stop lumaforge-cloud || true
docker rm lumaforge-cloud || true
docker run -d \
  --name lumaforge-cloud \
  --restart unless-stopped \
  -e CLOUD_CONFIG_DB=/app/data/cloud_config.db \
  -e CLOUD_APP_VERSION=2.0.1 \
  -p 127.0.0.1:8787:8787 \
  -v /opt/lumaforge-cloud/cloud-data:/app/data \
  iguang9881/lumaforge-cloud:2.0.1
```

## 注意事项

- 不要把 `assets/`、`output/`、`data/`、`userdata/`、`cloud-data/` 打进源码发布包。
- EXE 原地热更新仍不作为 2.0.1 保证能力，浏览器/源码版支持源码级更新。
- Windows 未签名 EXE 仍可能触发 SmartScreen，这是签名问题，不是代码问题。
