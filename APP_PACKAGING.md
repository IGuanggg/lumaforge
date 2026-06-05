# LumaForge ����벿��

Ŀ��汾��`2.0.28`

## ���洰�ڰ�

```powershell
.\build_desktop.bat
```

���

```text
dist\LumaForge\LumaForge.exe
```

���������������� zip����ѡ��װ������ѡ����ǩ������

```powershell
.\scripts\build_desktop_release.ps1
```

�������Զ�����ʹ�õ� zip ������� `LumaForge/` ��Ŀ¼��

```text
LumaForge-2.0.28-desktop.zip
  LumaForge\
    LumaForge.exe
    LumaForgeUpdater.exe
    _internal\
    static\
    workflows\
```

Ĭ��Ŀ¼��

- Runtime: `%APPDATA%\LumaForge`
- Images: `%USERPROFILE%\Pictures\LumaForge`
- Logs: `%LOCALAPPDATA%\LumaForge\logs`

## ������� EXE

```powershell
.\build_windows.bat
```

���

```text
dist\LumaForge Browser\LumaForge.exe
```

���������Զ�ѡ��˿ڡ�������� FastAPI ���񲢴�ϵͳ������������� EXE �Աߵ� `userdata/`��

## macOS ��

macOS ��������� macOS �Ϲ����������� Windows �Ͻ�����룺

```bash
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install --upgrade pip
VERSION=2.0.28 bash scripts/build_macos_release.sh
```

Ҳ������ GitHub Actions �ֶ����� `Build macOS Release` workflow������ `v2.0.28` tag ʱ���� workflow ���� macOS runner �Ϲ������� macOS zip �ϴ��� GitHub Release��

���

```text
releases/LumaForge-2.0.28-macos.zip
releases/LumaForge-2.0.28-macos.sha256.txt
```

��ʽ�ַ������� macOS ��׷�� Apple Developer ǩ���͹�֤��

```bash
codesign --deep --force --options runtime --sign "Developer ID Application: YOUR NAME (TEAMID)" "dist/LumaForge.app"
xcrun notarytool submit "releases/LumaForge-2.0.28-macos.zip" --keychain-profile "notarytool-profile" --wait
```

## Դ������

```powershell
pip install -r requirements.txt
python launcher.py
```

## �ƺ�� Docker

��������`lumaforge-cloud`

����`iguang9881/lumaforge-cloud`

�־û�Ŀ¼��`/opt/lumaforge-cloud/cloud-data`

```bash
mkdir -p /opt/lumaforge-cloud/cloud-data
cd /opt/lumaforge-cloud
docker pull iguang9881/lumaforge-cloud:2.0.28
docker stop lumaforge-cloud || true
docker rm lumaforge-cloud || true
docker run -d \
  --name lumaforge-cloud \
  --restart unless-stopped \
  -e CLOUD_CONFIG_DB=/app/data/cloud_config.db \
  -e CLOUD_APP_VERSION=2.0.28 \
  -p 127.0.0.1:8787:8787 \
  -v /opt/lumaforge-cloud/cloud-data:/app/data \
  iguang9881/lumaforge-cloud:2.0.28
```

## ע������

- ��Ҫ�� `assets/`��`output/`��`data/`��`userdata/`��`cloud-data/` ���Դ�뷢������
- EXE �Զ�����������������ͬʱ���� `LumaForge.exe` �� `LumaForgeUpdater.exe`����Ҫֻ�ϴ����� EXE��
- ����ǩ���ű�ֻ��Ԥ���δ������ʵ֤��ʱ������ǩ����δǩ�� EXE �Կ��ܴ��� SmartScreen������ǩ�����⣬���Ǵ������⡣
