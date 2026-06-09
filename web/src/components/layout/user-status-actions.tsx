"use client";

import type { CSSProperties, RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { App, Avatar, Button, Divider, Drawer, Form, Input, Space, Spin, Tag, Tooltip } from "antd";
import { BookOpen, CheckCircle2, Cloud, DownloadCloud, Keyboard, LogOut, RefreshCw, Settings, Shield, SlidersHorizontal, UploadCloud } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { GitHubLink } from "@/components/layout/github-link";
import { VersionReleaseModal } from "@/components/layout/version-release-modal";
import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { CreditSymbol } from "@/constant/credits";
import { DOCS_URL } from "@/constant/env";
import { canvasThemes } from "@/lib/canvas-theme";
import { cn } from "@/lib/utils";
import {
    changeCloudPassword,
    confirmEmailVerify,
    downloadCloudConfig,
    fetchCloudMediaStatus,
    fetchCloudProfile,
    fetchCloudStatus,
    requestEmailVerify,
    restoreCloudMedia,
    saveCloudProfile,
    syncCloudMedia,
    uploadCloudAvatar,
    uploadCloudConfig,
    type CloudMediaStatus,
    type CloudStatus,
} from "@/services/api/cloud";
import { useConfigStore } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";

type UserStatusActionsProps = {
    showConfig?: boolean;
    variant?: "default" | "canvas";
    onOpenShortcuts?: () => void;
    accountOpen?: boolean;
    onAccountOpenChange?: (open: boolean) => void;
    accountRef?: RefObject<HTMLDivElement | null>;
    getPopupContainer?: (node: HTMLElement) => HTMLElement;
};

type AccountCache = {
    status: CloudStatus | null;
    media: CloudMediaStatus | null;
    updatedAt: number;
};

const ACCOUNT_CACHE_TTL = 45_000;
let accountCache: AccountCache = { status: null, media: null, updatedAt: 0 };

export function UserStatusActions({ showConfig = true, variant = "default", onOpenShortcuts, accountRef }: UserStatusActionsProps) {
    const pathname = usePathname();
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const user = useUserStore((state) => state.user);
    const logout = useUserStore((state) => state.clearSession);
    const hydrateUser = useUserStore((state) => state.hydrateUser);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const canvasTheme = canvasThemes[theme];
    const userName = user?.displayName || user?.username || "";
    const credits = user?.credits ?? 0;
    const avatarUrl = user?.avatarUrl?.trim();
    const avatarText = (userName.trim()[0] || "U").toUpperCase();
    const [accountDrawerOpen, setAccountDrawerOpen] = useState(false);
    const naturalIconClass = "inline-flex size-7 shrink-0 items-center justify-center text-stone-600 transition hover:text-stone-950 dark:text-stone-300 dark:hover:text-white [&_svg]:size-4";
    const appSettingsActive = pathname === "/app-settings";
    const iconStyle: CSSProperties | undefined = variant === "canvas" ? { color: canvasTheme.node.text } : undefined;
    const avatarStyle: CSSProperties | undefined = variant === "canvas" ? { borderColor: canvasTheme.toolbar.border, color: canvasTheme.node.text, background: "transparent" } : undefined;

    return (
        <div className="inline-flex shrink-0 items-center gap-1">
            <a href={DOCS_URL} target="_blank" rel="noopener noreferrer" className={naturalIconClass} style={iconStyle} aria-label="文档" title="文档">
                <BookOpen className="size-4" />
            </a>
            {showConfig ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={() => openConfigDialog(false)} aria-label="配置" title="配置">
                    <SlidersHorizontal className="size-4" />
                </button>
            ) : null}
            <Link href="/app-settings" className={cn(naturalIconClass, appSettingsActive && "text-stone-950 dark:text-stone-100")} style={iconStyle} aria-label="应用设置" title="应用设置">
                <Settings className="size-4" />
            </Link>
            <AnimatedThemeToggler theme={theme} onThemeChange={setTheme} className={naturalIconClass} style={iconStyle} aria-label={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"} title={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"} />
            <VersionReleaseModal style={iconStyle} />
            <GitHubLink className="size-7 bg-transparent text-base hover:bg-transparent dark:hover:bg-transparent" style={iconStyle} />
            {variant === "canvas" && user ? (
                <Tooltip title="当前算力点余额" placement="bottom">
                    <div className="flex h-8 shrink-0 items-center gap-1.5 px-1.5 text-xs font-medium tabular-nums opacity-75 transition hover:opacity-100" style={{ color: canvasTheme.node.text }}>
                        <CreditSymbol className="text-sm leading-none" />
                        <span>{credits.toLocaleString()}</span>
                    </div>
                </Tooltip>
            ) : null}
            {!user && onOpenShortcuts ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={onOpenShortcuts} aria-label="快捷键" title="快捷键">
                    <Keyboard className="size-4" />
                </button>
            ) : null}
            {!user ? (
                <Link href="/login" className="px-1.5 text-sm font-medium text-stone-600 underline-offset-4 transition hover:text-stone-950 hover:underline dark:text-stone-300 dark:hover:text-stone-100" style={iconStyle}>
                    登录
                </Link>
            ) : null}
            {user ? (
                <div ref={accountRef}>
                    <button type="button" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-transparent p-0 text-[0] leading-[0] transition" aria-label="账户设置" title="账户设置" onClick={() => setAccountDrawerOpen(true)}>
                        <Avatar
                            size={24}
                            src={avatarUrl ? <img src={avatarUrl} alt={userName} referrerPolicy="no-referrer" /> : undefined}
                            alt={userName}
                            className="!flex !items-center !justify-center border border-stone-300 bg-transparent text-[11px] font-semibold text-stone-800 transition hover:border-stone-500 hover:text-stone-950 dark:border-stone-700 dark:text-stone-100 dark:hover:border-stone-400 dark:hover:text-white"
                            style={avatarStyle}
                        >
                            {avatarText}
                        </Avatar>
                    </button>
                    <AccountDrawer
                        open={accountDrawerOpen}
                        onClose={() => setAccountDrawerOpen(false)}
                        onLogout={() => {
                            logout();
                            setAccountDrawerOpen(false);
                        }}
                        onRefreshUser={() => void hydrateUser()}
                    />
                </div>
            ) : null}
        </div>
    );
}

function AccountDrawer({ open, onClose, onLogout, onRefreshUser }: { open: boolean; onClose: () => void; onLogout: () => void; onRefreshUser: () => void }) {
    const { message } = App.useApp();
    const [profileForm] = Form.useForm();
    const [passwordForm] = Form.useForm();
    const [verifyForm] = Form.useForm();
    const [status, setStatus] = useState<CloudStatus | null>(accountCache.status);
    const [media, setMedia] = useState<CloudMediaStatus | null>(accountCache.media);
    const [loadingStatus, setLoadingStatus] = useState(false);
    const [loadingMedia, setLoadingMedia] = useState(false);
    const [busy, setBusy] = useState("");
    const fileInputRef = useRef<HTMLInputElement>(null);
    const requestSeqRef = useRef(0);

    const applyStatus = useCallback(
        (nextStatus: CloudStatus) => {
            setStatus(nextStatus);
            accountCache = { ...accountCache, status: nextStatus, updatedAt: Date.now() };
            profileForm.setFieldsValue({ email: nextStatus.email, display_name: nextStatus.display_name, avatar_url: nextStatus.avatar_url });
        },
        [profileForm],
    );

    const reload = useCallback(
        async ({ force = false, includeMedia = true }: { force?: boolean; includeMedia?: boolean } = {}) => {
            const seq = requestSeqRef.current + 1;
            requestSeqRef.current = seq;
            const cachedStatus = accountCache.status;
            const cacheFresh = Boolean(cachedStatus) && Date.now() - accountCache.updatedAt < ACCOUNT_CACHE_TTL;
            if (!force && cachedStatus && cacheFresh) {
                setStatus(cachedStatus);
                if (accountCache.media) setMedia(accountCache.media);
                profileForm.setFieldsValue({ email: cachedStatus.email, display_name: cachedStatus.display_name, avatar_url: cachedStatus.avatar_url });
                return;
            }

            setLoadingStatus(true);
            try {
                const nextStatus = await fetchCloudStatus(true);
                if (requestSeqRef.current !== seq) return;
                applyStatus(nextStatus);
            } catch (error) {
                if (requestSeqRef.current === seq) message.warning(error instanceof Error ? error.message : "账户状态刷新失败");
            } finally {
                if (requestSeqRef.current === seq) setLoadingStatus(false);
            }

            if (!includeMedia) return;
            setLoadingMedia(true);
            try {
                const nextMedia = await fetchCloudMediaStatus();
                if (requestSeqRef.current !== seq) return;
                setMedia(nextMedia);
                accountCache = { ...accountCache, media: nextMedia, updatedAt: Date.now() };
            } catch {
                // 素材统计不阻塞账户抽屉。
            } finally {
                if (requestSeqRef.current === seq) setLoadingMedia(false);
            }
        },
        [applyStatus, message, profileForm],
    );

    useEffect(() => {
        if (!open) return;
        void reload({ force: false, includeMedia: false });
        const timer = window.setTimeout(() => {
            void reload({ force: false, includeMedia: true });
        }, 250);
        return () => window.clearTimeout(timer);
    }, [open, reload]);

    const run = async (key: string, action: () => Promise<unknown>, after?: () => void) => {
        setBusy(key);
        try {
            await action();
            await reload({ force: true, includeMedia: key.startsWith("media") });
            onRefreshUser();
            after?.();
            message.success("操作完成");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "操作失败");
        } finally {
            setBusy("");
        }
    };

    const loggedIn = Boolean(status?.logged_in);
    return (
        <Drawer title="账户设置" open={open} onClose={onClose} width={520} classNames={{ body: "bg-stone-50 dark:bg-stone-950" }}>
            <div className="space-y-4">
                <section className="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
                    <div className="flex items-center gap-3">
                        <Avatar size={44} src={status?.avatar_url || undefined}>
                            {(status?.display_name || status?.email || "U").slice(0, 1).toUpperCase()}
                        </Avatar>
                        <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold text-stone-950 dark:text-stone-100">{status?.display_name || status?.email || (loadingStatus ? "正在读取账户..." : "未登录")}</div>
                            <div className="truncate text-xs text-stone-500 dark:text-stone-400">{status?.email || "登录后可同步配置、素材和画布"}</div>
                        </div>
                        {loadingStatus ? <Spin size="small" /> : status?.email_verified ? <Tag color="green">邮箱已验证</Tag> : <Tag>未验证</Tag>}
                    </div>
                </section>

                {loggedIn ? (
                    <>
                        <section className="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
                            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                                <Shield className="size-4" />
                                资料与邮箱
                            </div>
                            <Form form={profileForm} layout="vertical" requiredMark={false}>
                                <Form.Item name="email" label="邮箱">
                                    <Input disabled />
                                </Form.Item>
                                <Form.Item name="display_name" label="昵称">
                                    <Input placeholder="显示名称" />
                                </Form.Item>
                                <Form.Item name="avatar_url" label="头像 URL">
                                    <Input placeholder="https://..." />
                                </Form.Item>
                            </Form>
                            <Space wrap>
                                <Button loading={busy === "save-profile"} onClick={() => run("save-profile", () => saveCloudProfile(profileForm.getFieldsValue()))}>
                                    保存资料
                                </Button>
                                <Button onClick={() => fileInputRef.current?.click()}>上传头像</Button>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/*"
                                    hidden
                                    onChange={(event) => {
                                        const file = event.target.files?.[0];
                                        event.target.value = "";
                                        if (file) void run("avatar", () => uploadCloudAvatar(file));
                                    }}
                                />
                            </Space>
                            <Divider />
                            <Space.Compact className="w-full">
                                <Form form={verifyForm} className="flex-1">
                                    <Form.Item name="token" className="!mb-0">
                                        <Input placeholder="邮箱验证码" />
                                    </Form.Item>
                                </Form>
                                <Button loading={busy === "verify-request"} onClick={() => run("verify-request", requestEmailVerify)}>
                                    发送验证
                                </Button>
                                <Button type="primary" loading={busy === "verify-confirm"} onClick={() => run("verify-confirm", () => confirmEmailVerify(verifyForm.getFieldValue("token")))}>
                                    确认
                                </Button>
                            </Space.Compact>
                        </section>

                        <section className="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
                            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                                <Cloud className="size-4" />
                                云端同步
                                {loadingMedia ? <Spin size="small" /> : null}
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-xs text-stone-500 dark:text-stone-400">
                                <Stat label="本地素材" value={media?.local?.count ?? 0} />
                                <Stat label="云端素材" value={media?.remote?.count ?? "-"} />
                                <Stat label="已同步" value={media?.local?.synced ?? 0} />
                                <Stat label="待同步" value={media?.local?.pending ?? 0} />
                            </div>
                            <Space wrap className="mt-4">
                                <Button icon={<UploadCloud className="size-4" />} loading={busy === "config-upload"} onClick={() => run("config-upload", uploadCloudConfig)}>
                                    上传配置
                                </Button>
                                <Button
                                    icon={<DownloadCloud className="size-4" />}
                                    loading={busy === "config-download"}
                                    onClick={() =>
                                        run("config-download", downloadCloudConfig, () => {
                                            window.dispatchEvent(new Event("providers-changed"));
                                            try {
                                                new BroadcastChannel("lumaforge-providers").postMessage({ type: "providers-changed", source: "account-drawer" });
                                            } catch {
                                                // 仅用于刷新当前页面，配置仍以磁盘文件为准。
                                            }
                                        })
                                    }
                                >
                                    下载配置
                                </Button>
                                <Button icon={<UploadCloud className="size-4" />} loading={busy === "media-sync"} onClick={() => run("media-sync", syncCloudMedia)}>
                                    同步素材
                                </Button>
                                <Button icon={<DownloadCloud className="size-4" />} loading={busy === "media-restore"} onClick={() => run("media-restore", restoreCloudMedia)}>
                                    恢复云素材
                                </Button>
                            </Space>
                        </section>

                        <section className="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
                            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                                <CheckCircle2 className="size-4" />
                                修改密码
                            </div>
                            <Form form={passwordForm} layout="vertical" requiredMark={false}>
                                <Form.Item name="current_password" label="当前密码">
                                    <Input.Password autoComplete="current-password" />
                                </Form.Item>
                                <Form.Item name="new_password" label="新密码">
                                    <Input.Password autoComplete="new-password" />
                                </Form.Item>
                            </Form>
                            <Button loading={busy === "password"} onClick={() => run("password", () => changeCloudPassword(passwordForm.getFieldsValue()), () => passwordForm.resetFields())}>
                                保存新密码
                            </Button>
                        </section>
                    </>
                ) : null}

                <div className="flex justify-between">
                    <Button icon={<RefreshCw className="size-4" />} loading={loadingStatus} onClick={() => void fetchCloudProfile().then(() => reload({ force: true, includeMedia: true }))}>
                        刷新账户
                    </Button>
                    <Button danger icon={<LogOut className="size-4" />} onClick={onLogout}>
                        退出登录
                    </Button>
                </div>
            </div>
        </Drawer>
    );
}

function Stat({ label, value }: { label: string; value: string | number }) {
    return (
        <div className="rounded-md border border-stone-200 bg-stone-50 p-3 dark:border-stone-800 dark:bg-stone-950">
            <div>{label}</div>
            <div className="mt-1 text-base font-semibold text-stone-950 dark:text-stone-100">{value}</div>
        </div>
    );
}
