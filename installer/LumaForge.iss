; LumaForge Installer - Inno Setup Script
; Build with: ISCC.exe LumaForge.iss
;
; Code signing: set WINDOWS_SIGN_CERT_PATH and WINDOWS_SIGN_CERT_PASSWORD
; environment variables before building, or configure SignTool below.

#define MyAppName "LumaForge"
#define MyAppNameCN "光绘工坊"
#define MyAppVersion "2.0.12"
#define MyAppPublisher "IGuanggg"
#define MyAppURL "https://github.com/IGuanggg/lumaforge"
#define MyAppExeName "LumaForge.exe"

[Setup]
AppId={{E7A3B2C1-D4F5-4A6B-8C9D-0E1F2A3B4C5D}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
AllowNoIcons=yes
; Uncomment the following line to enable code signing:
; SignTool=signtool /f "$%WINDOWS_SIGN_CERT_PATH%" /p "$%WINDOWS_SIGN_CERT_PASSWORD%" /tr http://timestamp.digicert.com /td sha256 /fd sha256 $f
OutputDir=..\releases
OutputBaseFilename=LumaForge-Setup-{#MyAppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "..\dist\LumaForge\LumaForge.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\dist\LumaForge\LumaForgeUpdater.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\dist\LumaForge\_internal\*"; DestDir: "{app}\_internal"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Do NOT delete user data directories:
; %APPDATA%\LumaForge
; %USERPROFILE%\Pictures\LumaForge
; %LOCALAPPDATA%\LumaForge
Type: filesandordirs; Name: "{app}\_internal"
Type: filesandordirs; Name: "{app}\static"
Type: filesandordirs; Name: "{app}\workflows"
Type: files; Name: "{app}\LumaForge.exe"
Type: files; Name: "{app}\LumaForgeUpdater.exe"
