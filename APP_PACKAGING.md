# Infinite Canvas 打包与部署

本项目主应用支持三种交付方式。

## 1. Windows 桌面窗口版（推荐正式发布）

桌面窗口版会启动本地 FastAPI 服务，并在独立 Windows 应用窗口中打开前端，不再弹出默认浏览器。

### 构建

```powershell
build_desktop.bat

# 或手动构建
pip install -r requirements.txt pyinstaller
pyinstaller desktop_canvas.spec --noconfirm
```

### 构建产物

```
dist/Infinite Canvas Desktop/
  Infinite Canvas.exe
  _internal/
```

### 桌面版默认目录

```
运行数据：%APPDATA%\Infinite Canvas\
图片/视频/素材：%USERPROFILE%\Pictures\Infinite Canvas\
日志：%LOCALAPPDATA%\Infinite Canvas\logs\
```

桌面版依赖 Microsoft Edge WebView2 Runtime。Windows 11 通常已自带，少数 Windows 10 机器可能需要单独安装。

## 2. Windows 浏览器版 EXE（推荐调试/备用）

### 构建

```powershell
# 方式 A：一键脚本
build_windows.bat

# 方式 B：手动构建
pip install -r requirements.txt pyinstaller
pyinstaller infinite_canvas.spec
```

### 构建产物

```
dist/Infinite Canvas/
  Infinite Canvas.exe    # 主程序
  _internal/             # PyInstaller 运行时
  static/                # 前端页面（打包时复制）
  workflows/             # 内置工作流（打包时复制）
  userdata/              # 运行时数据（首次启动自动创建）
```

### EXE 行为

- 自动选择可用端口（默认 3000，被占用则随机分配）
- 自动打开浏览器
- 仅监听 `127.0.0.1`（本机访问，局域网不可访问）
- 运行时数据写入 EXE 旁边的 `userdata/` 目录
- EXE 图标来自 `static/logo.ico`，保持与主页 Logo 一致
- 关闭终端窗口即停止服务

### 环境变量（可选）

```powershell
$env:APP_PORT="3000"                              # 指定端口
$env:APP_RUNTIME_DIR="D:\InfiniteCanvasData"      # 自定义数据目录
$env:CLOUD_SYNC_BASE_URL="https://your-domain"   # 云后端地址
```

## 3. 源码运行（推荐开发者）

```powershell
pip install -r requirements.txt
python launcher.py
```

`launcher.py` 功能与 EXE 启动器相同：自动选端口、自动开浏览器、仅监听 127.0.0.1。

直接运行 `python main.py` 则监听 `0.0.0.0:3000`（局域网可访问）。

## 4. Docker 部署（推荐服务器）

```bash
cp .env.example .env   # 编辑配置
docker compose up -d --build
```

数据通过 `./userdata:/app/userdata` 卷挂载持久化。

升级：

```bash
docker compose pull
docker compose up -d
```

## 云后端

云后端独立部署，提供账户、邮箱验证、配置同步、云备份。

```bash
cp .env.cloud.example .env.cloud   # 编辑 SMTP、管理员密码等
docker compose -f docker-compose.cloud.yml up -d --build
```

详见 README.md「Docker 部署（云后端）」章节。
