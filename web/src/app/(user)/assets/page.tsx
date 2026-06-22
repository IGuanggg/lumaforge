"use client";

import { Copy, Download, ExternalLink, History, PencilLine, RefreshCw, Search, Trash2, Upload, UploadCloud } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { App, Button, Card, Drawer, Empty, Form, Image, Input, Modal, Pagination, Select, Space, Tag, Typography } from "antd";

import { useCopyText } from "@/hooks/use-copy-text";
import { formatBytes, readFileAsDataUrl } from "@/lib/image-utils";
import { uploadImage } from "@/services/image-storage";
import { uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { fetchAssetLibrary, type AssetLibraryItem } from "@/services/api/assets";
import { fetchCloudMediaStatus, restoreCloudMedia, syncCloudMedia, type CloudMediaStatus } from "@/services/api/cloud";
import { openSavedFileLocation, saveFileWithPrompt } from "@/services/api/downloads";
import { DownloadHistoryDrawer } from "@/components/download-history-drawer";
import { cn } from "@/lib/utils";
import { useAssetStore, type Asset, type AssetKind, type ImageAsset } from "@/stores/use-asset-store";
import { exportAssets, readAssetPackage } from "./asset-transfer";

type AssetFormValues = {
    kind: AssetKind;
    title: string;
    coverUrl: string;
    tags: string[];
    source?: string;
    note?: string;
    content?: string;
};

type ImageDraft = ImageAsset["data"] | null;
type MediaDraft = (Omit<UploadedFile, "storageKey"> & { storageKey?: string }) | null;
type DisplayAsset = Asset & { readonly?: boolean; backendId?: string };
type AssetContextMenuState = {
    asset: DisplayAsset;
    x: number;
    y: number;
};

const kindOptions = [
    { label: "全部", value: "all" },
    { label: "文本", value: "text" },
    { label: "图片", value: "image" },
    { label: "视频", value: "video" },
    { label: "音频", value: "audio" },
];

export default function AssetsPage() {
    const { message } = App.useApp();
    const copyText = useCopyText();
    const [form] = Form.useForm<AssetFormValues>();
    const coverInputRef = useRef<HTMLInputElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const mediaInputRef = useRef<HTMLInputElement>(null);
    const assetInputRef = useRef<HTMLInputElement>(null);
    const assets = useAssetStore((state) => state.assets);
    const addAsset = useAssetStore((state) => state.addAsset);
    const updateAsset = useAssetStore((state) => state.updateAsset);
    const removeAsset = useAssetStore((state) => state.removeAsset);
    const [backendAssets, setBackendAssets] = useState<DisplayAsset[]>([]);
    const [mediaStatus, setMediaStatus] = useState<CloudMediaStatus | null>(null);
    const [loadingRemote, setLoadingRemote] = useState(false);
    const [remoteLoadError, setRemoteLoadError] = useState("");
    const [syncing, setSyncing] = useState("");
    const [keyword, setKeyword] = useState("");
    const [kindFilter, setKindFilter] = useState<AssetKind | "all">("all");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(12);
    const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
    const [isAssetOpen, setIsAssetOpen] = useState(false);
    const [previewAsset, setPreviewAsset] = useState<DisplayAsset | null>(null);
    const [deletingAsset, setDeletingAsset] = useState<DisplayAsset | null>(null);
    const [assetContextMenu, setAssetContextMenu] = useState<AssetContextMenuState | null>(null);
    const [downloadHistoryOpen, setDownloadHistoryOpen] = useState(false);
    const [formKind, setFormKind] = useState<AssetKind>("text");
    const [imageDraft, setImageDraft] = useState<ImageDraft>(null);
    const [mediaDraft, setMediaDraft] = useState<MediaDraft>(null);
    const coverUrl = Form.useWatch("coverUrl", form) || "";
    const title = Form.useWatch("title", form) || "";
    const tags = Form.useWatch("tags", form) || [];
    const content = Form.useWatch("content", form) || "";

    const localAssets = useMemo(() => assets.filter((asset) => asset.kind === "text" || asset.kind === "image" || asset.kind === "video" || asset.kind === "audio") as DisplayAsset[], [assets]);
    const mergedAssets = useMemo(() => dedupeAssets([...backendAssets, ...localAssets]), [backendAssets, localAssets]);

    const filteredAssets = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return mergedAssets.filter((asset) => {
            if (kindFilter !== "all" && asset.kind !== kindFilter) return false;
            if (!query) return true;
            return assetSearchText(asset).includes(query);
        });
    }, [mergedAssets, keyword, kindFilter]);

    const visibleAssets = useMemo(() => {
        const start = (page - 1) * pageSize;
        return filteredAssets.slice(start, start + pageSize);
    }, [filteredAssets, page, pageSize]);

    const loadRemoteAssets = async () => {
        setLoadingRemote(true);
        try {
            const [library, status] = await Promise.all([fetchAssetLibrary({ page: 1, pageSize: 500 }), fetchCloudMediaStatus().catch(() => null)]);
            setBackendAssets(library.items.map(libraryItemToAsset));
            if (status) setMediaStatus(status);
            setRemoteLoadError("");
        } catch (error) {
            setBackendAssets([]);
            setRemoteLoadError(error instanceof Error ? error.message : "后端素材库暂不可用");
            console.warn("Asset library unavailable, showing local assets only.", error);
        } finally {
            setLoadingRemote(false);
        }
    };

    useEffect(() => {
        void loadRemoteAssets();
    }, []);

    useEffect(() => {
        const maxPage = Math.max(1, Math.ceil(filteredAssets.length / pageSize));
        setPage((value) => Math.min(value, maxPage));
    }, [filteredAssets.length, pageSize]);

    useEffect(() => {
        if (!assetContextMenu) return;
        const close = () => setAssetContextMenu(null);
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") close();
        };
        window.addEventListener("pointerdown", close);
        window.addEventListener("keydown", handleKeyDown);
        return () => {
            window.removeEventListener("pointerdown", close);
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [assetContextMenu]);

    const runCloudAction = async (key: string, action: () => Promise<unknown>, success: string) => {
        setSyncing(key);
        try {
            await action();
            await loadRemoteAssets();
            message.success(success);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "操作失败");
        } finally {
            setSyncing("");
        }
    };

    const openCreate = () => {
        setEditingAsset(null);
        setImageDraft(null);
        setMediaDraft(null);
        setFormKind("text");
        form.setFieldsValue({ kind: "text", title: "", coverUrl: "", tags: [], source: "手动添加", note: "", content: "" });
        setIsAssetOpen(true);
    };

    const openEdit = (asset: DisplayAsset) => {
        if (asset.readonly) return;
        setEditingAsset(asset);
        setFormKind(asset.kind);
        setImageDraft(asset.kind === "image" ? asset.data : null);
        setMediaDraft(asset.kind === "video" || asset.kind === "audio" ? { ...asset.data } : null);
        form.setFieldsValue({
            kind: asset.kind,
            title: asset.title,
            coverUrl: asset.coverUrl,
            tags: asset.tags || [],
            source: asset.source,
            note: asset.note,
            content: asset.kind === "text" ? asset.data.content : "",
        });
        setIsAssetOpen(true);
    };

    const saveAsset = async () => {
        const values = await form.validateFields();
        const base = {
            title: values.title.trim(),
            coverUrl: values.coverUrl?.trim() || (values.kind === "image" && imageDraft ? imageDraft.dataUrl : ""),
            tags: values.tags || [],
            source: values.source?.trim(),
            note: values.note?.trim(),
            metadata: editingAsset?.metadata || { source: "manual" },
        };

        if (values.kind === "text") {
            const asset = { ...base, kind: "text" as const, data: { content: (values.content || "").trim() } };
            editingAsset ? updateAsset(editingAsset.id, asset) : addAsset(asset);
        } else if (values.kind === "image") {
            if (!imageDraft) {
                message.error("请选择图片文件");
                return;
            }
            const asset = { ...base, kind: "image" as const, data: imageDraft };
            editingAsset ? updateAsset(editingAsset.id, asset) : addAsset(asset);
        } else {
            if (!mediaDraft) {
                message.error(values.kind === "video" ? "请选择视频文件" : "请选择音频文件");
                return;
            }
            const asset =
                values.kind === "video"
                    ? { ...base, kind: "video" as const, data: { url: mediaDraft.url, storageKey: mediaDraft.storageKey, width: mediaDraft.width || 0, height: mediaDraft.height || 0, bytes: mediaDraft.bytes, mimeType: mediaDraft.mimeType } }
                    : { ...base, kind: "audio" as const, data: { url: mediaDraft.url, storageKey: mediaDraft.storageKey, bytes: mediaDraft.bytes, mimeType: mediaDraft.mimeType, durationMs: mediaDraft.durationMs } };
            editingAsset ? updateAsset(editingAsset.id, asset) : addAsset(asset);
        }

        message.success(editingAsset ? "素材已更新" : "素材已保存");
        setIsAssetOpen(false);
    };

    const readCoverFile = async (file?: File) => {
        if (!file) return;
        const dataUrl = await readFileAsDataUrl(file);
        form.setFieldValue("coverUrl", dataUrl);
    };

    const readImageFile = async (file?: File) => {
        if (!file || !file.type.startsWith("image/")) return;
        const image = await uploadImage(file);
        const draft = { dataUrl: image.url, storageKey: image.storageKey, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType };
        setImageDraft(draft);
        if (!form.getFieldValue("coverUrl")) form.setFieldValue("coverUrl", draft.dataUrl);
        if (!form.getFieldValue("title")) form.setFieldValue("title", file.name);
    };

    const readMediaFile = async (file?: File) => {
        if (!file || (formKind !== "video" && formKind !== "audio")) return;
        if (!file.type.startsWith(`${formKind}/`)) {
            message.error(formKind === "video" ? "请选择视频文件" : "请选择音频文件");
            return;
        }
        const draft = await uploadMediaFile(file, formKind);
        setMediaDraft(draft);
        if (!form.getFieldValue("title")) form.setFieldValue("title", file.name);
    };

    const copyAssetText = async (asset: DisplayAsset) => {
        if (asset.kind !== "text") return;
        copyText(asset.data.content, "文本已复制");
    };

    const fallbackAssetExtension = (kind: AssetKind) => {
        if (kind === "video") return "mp4";
        if (kind === "audio") return "mp3";
        if (kind === "image") return "png";
        return "txt";
    };

    const assetExtension = (asset: DisplayAsset) => {
        if (asset.kind === "text") return "txt";
        const mimeType = asset.kind === "image" || asset.kind === "video" || asset.kind === "audio" ? asset.data.mimeType : "";
        const subtype = mimeType.split("/")[1]?.split(";")[0]?.trim().toLowerCase();
        if (subtype) {
            if (subtype === "jpeg") return "jpg";
            if (subtype === "mpeg") return asset.kind === "audio" ? "mp3" : "mpeg";
            if (subtype === "x-wav") return "wav";
            return subtype.replace(/[^a-z0-9.+-]/g, "") || fallbackAssetExtension(asset.kind);
        }
        return fallbackAssetExtension(asset.kind);
    };

    const safeAssetFileStem = (value: string) =>
        String(value || "asset")
            .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 80) || "asset";

    const downloadAsset = async (asset: DisplayAsset) => {
        if (asset.kind !== "image" && asset.kind !== "video" && asset.kind !== "audio") return;
        const url = asset.backendId ? `/api/assets/${encodeURIComponent(asset.backendId)}/download` : asset.kind === "image" ? asset.data.dataUrl : asset.data.url;
        const filename = `${safeAssetFileStem(asset.title || "asset")}.${assetExtension(asset)}`;
        const result = await saveFileWithPrompt(url, filename);
        if (result.cancelled) {
            message.info("已取消保存");
            return;
        }
        if (!result.ok) {
            message.error(result.message || "下载失败");
            return;
        }
        if (result.fallback) {
            message.success(result.message || "已交给浏览器下载，文件会进入浏览器默认下载目录");
            return;
        }
        if (result.path) {
            message.success({
                content: (
                    <span className="inline-flex items-center gap-2">
                        <span>{`已保存到：${result.path}`}</span>
                        <button type="button" className="text-[#2f80ff] underline-offset-2 hover:underline" onClick={() => void openSavedFileLocation(result.path!)}>
                            打开所在文件夹
                        </button>
                    </span>
                ),
                duration: 8,
            });
            return;
        }
        message.success("保存完成");
    };

    const exportAllAssets = async () => {
        const exportable = mergedAssets.filter((asset) => !asset.readonly);
        if (!exportable.length) {
            message.warning("暂无可导出的本地素材");
            return;
        }
        await exportAssets(exportable);
    };

    const importAssetZip = async (file?: File) => {
        if (!file) return;
        try {
            const importedAssets = await readAssetPackage(file);
            importedAssets.forEach((asset) => {
                const payload = { ...asset } as Record<string, unknown>;
                delete payload.id;
                delete payload.createdAt;
                delete payload.updatedAt;
                addAsset(payload as Parameters<typeof addAsset>[0]);
            });
            message.success(`已导入 ${importedAssets.length} 个素材`);
        } catch {
            message.error("导入失败，请选择有效的素材压缩包");
        } finally {
            if (assetInputRef.current) assetInputRef.current.value = "";
        }
    };

    const confirmDelete = async () => {
        if (!deletingAsset) return;
        if (deletingAsset.readonly && deletingAsset.backendId) {
            const response = await fetch(`/api/assets/${encodeURIComponent(deletingAsset.backendId)}`, { method: "DELETE" });
            if (!response.ok) {
                message.error("后端素材删除失败");
                return;
            }
            await loadRemoteAssets();
        } else {
            removeAsset(deletingAsset.id);
        }
        message.success("素材已删除");
        setDeletingAsset(null);
    };

    return (
        <div className="flex h-full flex-col overflow-hidden bg-background text-stone-900 dark:text-stone-100">
            <main className="min-h-0 flex-1 overflow-y-auto bg-stone-50 px-6 py-8 dark:bg-stone-950">
                <div className="mx-auto flex max-w-7xl flex-col gap-6">
                    <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                        <div>
                            <h1 className="text-3xl font-semibold tracking-tight text-stone-950 dark:text-stone-100">我的素材</h1>
                            <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">统一查看本地收藏、旧版素材库和云端恢复的图片/视频/文本。</p>
                        </div>
                        <Space wrap>
                            <Button icon={<RefreshCw className="size-4" />} loading={loadingRemote} onClick={() => void loadRemoteAssets()}>刷新</Button>
                            <Button icon={<History className="size-4" />} onClick={() => setDownloadHistoryOpen(true)}>最近下载</Button>
                            <Button icon={<UploadCloud className="size-4" />} loading={syncing === "sync"} onClick={() => runCloudAction("sync", syncCloudMedia, "云素材同步完成")}>同步素材</Button>
                            <Button icon={<Download className="size-4" />} loading={syncing === "restore"} onClick={() => runCloudAction("restore", restoreCloudMedia, "云素材恢复完成")}>恢复云素材</Button>
                            <Button onClick={openCreate}>新增素材</Button>
                        </Space>
                    </header>

                    <section className="grid gap-3 md:grid-cols-4">
                        <SummaryCard label="全部素材" value={mergedAssets.length} />
                        <SummaryCard label="后端素材库" value={backendAssets.length} />
                        <SummaryCard label="云端素材" value={mediaStatus?.remote?.count ?? "-"} />
                        <SummaryCard label="待同步" value={mediaStatus?.local?.pending ?? 0} />
                    </section>

                    <section className="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                            <Input.Search
                                className="max-w-xl"
                                allowClear
                                prefix={<Search className="size-4 text-stone-400" />}
                                value={keyword}
                                placeholder="搜索标题、提示词、模型、标签或来源"
                                onChange={(event) => {
                                    setPage(1);
                                    setKeyword(event.target.value);
                                }}
                            />
                            <div className="flex flex-wrap gap-2">
                                {kindOptions.map((option) => (
                                    <Tag.CheckableTag
                                        key={option.value}
                                        checked={kindFilter === option.value}
                                        className={cn("prompt-filter-tag", kindFilter === option.value && "is-active")}
                                        onChange={() => {
                                            setPage(1);
                                            setKindFilter(option.value as AssetKind | "all");
                                        }}
                                    >
                                        {option.label}
                                    </Tag.CheckableTag>
                                ))}
                            </div>
                            <Space wrap>
                                <Button onClick={() => void exportAllAssets()}>导出本地</Button>
                                <Button onClick={() => assetInputRef.current?.click()}>导入素材</Button>
                            </Space>
                        </div>
                    </section>

                    <section className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {visibleAssets.map((asset) => (
                            <AssetCard
                                key={asset.id}
                                asset={asset}
                                onOpen={() => setPreviewAsset(asset)}
                                onEdit={() => openEdit(asset)}
                                onCopy={copyAssetText}
                                onDownload={downloadAsset}
                                onDelete={() => setDeletingAsset(asset)}
                                onContextMenu={(event) => {
                                    event.preventDefault();
                                    setAssetContextMenu({ asset, x: event.clientX, y: event.clientY });
                                }}
                            />
                        ))}
                    </section>

                    {!visibleAssets.length ? (
                        <AssetsEmptyState
                            hasFilters={Boolean(keyword.trim()) || kindFilter !== "all"}
                            remoteLoadError={remoteLoadError}
                            onCreate={openCreate}
                            onImport={() => assetInputRef.current?.click()}
                            onClearFilters={() => {
                                setKeyword("");
                                setKindFilter("all");
                                setPage(1);
                            }}
                        />
                    ) : null}

                    <div className="flex justify-center">
                        <Pagination
                            current={page}
                            pageSize={pageSize}
                            total={filteredAssets.length}
                            showSizeChanger
                            pageSizeOptions={[12, 24, 48, 96]}
                            onChange={(nextPage, nextPageSize) => {
                                setPage(nextPage);
                                setPageSize(nextPageSize);
                            }}
                        />
                    </div>
                </div>
            </main>

            {assetContextMenu ? (
                <AssetContextMenu
                    menu={assetContextMenu}
                    onClose={() => setAssetContextMenu(null)}
                    onOpen={(asset) => setPreviewAsset(asset)}
                    onEdit={openEdit}
                    onCopy={(asset) => void copyAssetText(asset)}
                    onDownload={(asset) => void downloadAsset(asset)}
                    onDelete={(asset) => setDeletingAsset(asset)}
                />
            ) : null}

            <DownloadHistoryDrawer
                open={downloadHistoryOpen}
                onClose={() => setDownloadHistoryOpen(false)}
            />

            <Modal title={editingAsset ? "编辑素材" : "新增素材"} open={isAssetOpen} width={980} onCancel={() => setIsAssetOpen(false)} onOk={() => void saveAsset()} okText="保存" cancelText="取消" destroyOnHidden>
                <div className="grid gap-6 pt-1 lg:grid-cols-[minmax(0,1fr)_320px]">
                    <Form form={form} layout="vertical" requiredMark={false} initialValues={{ kind: "text", tags: [] }}>
                        <Form.Item name="kind" label="类型">
                            <Select
                                options={[
                                    { label: "文本", value: "text" },
                                    { label: "图片", value: "image" },
                                    { label: "视频", value: "video" },
                                    { label: "音频", value: "audio" },
                                ]}
                                onChange={(value) => {
                                    setFormKind(value);
                                    setImageDraft(null);
                                    setMediaDraft(null);
                                }}
                            />
                        </Form.Item>
                        <Form.Item name="title" label="标题" rules={[{ required: true, message: "请输入标题" }]}>
                            <Input size="large" placeholder="给素材起一个容易搜索的名字" />
                        </Form.Item>
                        <Form.Item name="coverUrl" label="封面 URL">
                            <Space.Compact className="w-full">
                                <Input placeholder="可粘贴图片 URL，也可以上传本地封面" />
                                <Button icon={<Upload className="size-3.5" />} onClick={() => coverInputRef.current?.click()}>上传</Button>
                            </Space.Compact>
                        </Form.Item>
                        <Form.Item name="tags" label="标签">
                            <Select mode="tags" tokenSeparators={[",", "，"]} placeholder="输入标签后回车" />
                        </Form.Item>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <Form.Item name="source" label="来源"><Input placeholder="手动添加 / 画布 / 提示词库" /></Form.Item>
                            <Form.Item name="note" label="备注"><Input placeholder="可选" /></Form.Item>
                        </div>
                        {formKind === "text" ? (
                            <Form.Item name="content" label="文本内容" rules={[{ required: true, message: "请输入文本内容" }]}>
                                <Input.TextArea rows={8} placeholder="保存提示词、说明文案、参考描述等文本素材" />
                            </Form.Item>
                        ) : formKind === "image" ? (
                            <Form.Item label="图片内容" required>
                                <div className="rounded-lg border border-dashed border-stone-300 p-4 dark:border-stone-700">
                                    <Button icon={<Upload className="size-4" />} onClick={() => imageInputRef.current?.click()}>选择图片文件</Button>
                                    <Typography.Text type="secondary" className="ml-3 text-xs">
                                        {imageDraft ? `${imageDraft.width}x${imageDraft.height} · ${formatBytes(imageDraft.bytes)}` : "未选择图片"}
                                    </Typography.Text>
                                </div>
                            </Form.Item>
                        ) : (
                            <Form.Item label={formKind === "video" ? "视频内容" : "音频内容"} required>
                                <div className="rounded-lg border border-dashed border-stone-300 p-4 dark:border-stone-700">
                                    <Button icon={<Upload className="size-4" />} onClick={() => mediaInputRef.current?.click()}>
                                        {formKind === "video" ? "选择视频文件" : "选择音频文件"}
                                    </Button>
                                    <Typography.Text type="secondary" className="ml-3 text-xs">
                                        {mediaDraft ? `${formatBytes(mediaDraft.bytes)}${mediaDraft.durationMs ? ` · ${Math.round(mediaDraft.durationMs / 1000)} 秒` : ""}` : formKind === "video" ? "未选择视频" : "未选择音频"}
                                    </Typography.Text>
                                </div>
                            </Form.Item>
                        )}
                    </Form>
                    <div className="rounded-xl border border-stone-200 bg-stone-50 p-4 dark:border-stone-800 dark:bg-stone-950">
                        <Typography.Text strong>预览</Typography.Text>
                        <div className="mt-3 overflow-hidden rounded-lg border border-stone-200 bg-background dark:border-stone-800">
                            {formKind === "video" && mediaDraft?.url ? (
                                <video src={mediaDraft.url} controls className="aspect-video w-full bg-black object-contain" />
                            ) : formKind === "audio" && mediaDraft?.url ? (
                                <div className="flex aspect-[4/3] flex-col items-center justify-center gap-4 bg-stone-100 p-5 dark:bg-stone-900">
                                    <span className="text-sm text-stone-500">音频素材</span>
                                    <audio src={mediaDraft.url} controls className="w-full" />
                                </div>
                            ) : coverUrl || imageDraft?.dataUrl ? (
                                <img src={coverUrl || imageDraft?.dataUrl} alt="" className="aspect-[4/3] w-full object-cover" />
                            ) : (
                                <div className="flex aspect-[4/3] items-center justify-center bg-stone-100 p-5 text-center text-sm text-stone-500 dark:bg-stone-900">{content || "暂无封面"}</div>
                            )}
                            <div className="p-4">
                                <Typography.Text strong ellipsis className="block">{title || "未命名素材"}</Typography.Text>
                                <div className="mt-2 flex flex-wrap gap-1.5">{tags.length ? tags.map((tag) => <Tag key={tag} className="m-0">{tag}</Tag>) : <Tag className="m-0">未打标签</Tag>}</div>
                            </div>
                        </div>
                    </div>
                </div>
                <input ref={coverInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => { void readCoverFile(event.target.files?.[0]); event.target.value = ""; }} />
                <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => { void readImageFile(event.target.files?.[0]); event.target.value = ""; }} />
                <input ref={mediaInputRef} type="file" accept={formKind === "video" ? "video/*" : "audio/*"} className="hidden" onChange={(event) => { void readMediaFile(event.target.files?.[0]); event.target.value = ""; }} />
            </Modal>

            <AssetDrawer asset={previewAsset} onClose={() => setPreviewAsset(null)} onCopy={copyAssetText} onDownload={downloadAsset} />
            <input ref={assetInputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => void importAssetZip(event.target.files?.[0])} />
            <Modal title="删除素材" open={Boolean(deletingAsset)} onCancel={() => setDeletingAsset(null)} onOk={() => void confirmDelete()} okText="删除" okButtonProps={{ danger: true }} cancelText="取消">
                确定删除“{deletingAsset?.title}”吗？后端素材会从素材库移除，本地收藏会从当前浏览器移除。
            </Modal>
        </div>
    );
}

function SummaryCard({ label, value }: { label: string; value: string | number }) {
    return <div className="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900"><div className="text-xs text-stone-500 dark:text-stone-400">{label}</div><div className="mt-2 text-2xl font-semibold text-stone-950 dark:text-stone-100">{value}</div></div>;
}

function AssetsEmptyState({ hasFilters, remoteLoadError, onCreate, onImport, onClearFilters }: { hasFilters: boolean; remoteLoadError: string; onCreate: () => void; onImport: () => void; onClearFilters: () => void }) {
    const title = hasFilters ? "没有匹配的素材" : "暂无素材";
    const description = remoteLoadError
        ? "后端素材库暂时不可用，当前只显示本地素材。可以先新增或导入本地素材。"
        : hasFilters
          ? "当前筛选条件下没有结果，可以清空筛选后再看。"
          : "新增、导入或从画布保存素材后，这里会统一管理图片、视频、音频和文本。";

    return (
        <section className="rounded-xl border border-dashed border-stone-200 bg-white px-6 py-14 text-center dark:border-stone-800 dark:bg-stone-900">
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<span className="font-medium text-stone-700 dark:text-stone-200">{title}</span>} />
            <p className="mx-auto -mt-4 max-w-lg text-sm leading-6 text-stone-500 dark:text-stone-400">{description}</p>
            {remoteLoadError ? <p className="mx-auto mt-2 max-w-lg text-xs leading-5 text-amber-600 dark:text-amber-300">{remoteLoadError}</p> : null}
            <div className="mt-5 flex flex-wrap justify-center gap-2">
                {hasFilters ? <Button onClick={onClearFilters}>清空筛选</Button> : null}
                <Button type="primary" onClick={onCreate}>
                    新增素材
                </Button>
                <Button onClick={onImport}>导入素材</Button>
            </div>
        </section>
    );
}

function AssetContextMenu({
    menu,
    onClose,
    onOpen,
    onEdit,
    onCopy,
    onDownload,
    onDelete,
}: {
    menu: AssetContextMenuState;
    onClose: () => void;
    onOpen: (asset: DisplayAsset) => void;
    onEdit: (asset: DisplayAsset) => void;
    onCopy: (asset: DisplayAsset) => void;
    onDownload: (asset: DisplayAsset) => void;
    onDelete: (asset: DisplayAsset) => void;
}) {
    const asset = menu.asset;
    const canDownload = asset.kind === "image" || asset.kind === "video" || asset.kind === "audio";
    const canEdit = !asset.readonly && asset.kind !== "video" && asset.kind !== "audio";
    const run = (action: () => void) => {
        onClose();
        action();
    };

    return (
        <div className="fixed z-[120] min-w-44 overflow-hidden rounded-lg border border-stone-200 bg-white py-1 text-sm text-stone-800 shadow-2xl dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100" style={{ left: menu.x, top: menu.y }} onPointerDown={(event) => event.stopPropagation()}>
            <AssetMenuButton label="查看" onClick={() => run(() => onOpen(asset))} />
            {canDownload ? <AssetMenuButton label={asset.kind === "video" ? "下载视频" : asset.kind === "audio" ? "下载音频" : "下载图片"} icon={<Download className="size-4" />} onClick={() => run(() => onDownload(asset))} /> : null}
            {asset.kind === "text" ? <AssetMenuButton label="复制文本" icon={<Copy className="size-4" />} onClick={() => run(() => onCopy(asset))} /> : null}
            {canEdit ? <AssetMenuButton label="编辑" icon={<PencilLine className="size-4" />} onClick={() => run(() => onEdit(asset))} /> : null}
            <AssetMenuButton label="删除" icon={<Trash2 className="size-4" />} danger onClick={() => run(() => onDelete(asset))} />
        </div>
    );
}

function AssetMenuButton({ label, icon, danger = false, onClick }: { label: string; icon?: ReactNode; danger?: boolean; onClick: () => void }) {
    return (
        <button type="button" className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-stone-100 dark:hover:bg-stone-800 ${danger ? "text-red-500" : ""}`} onClick={onClick}>
            {icon ? icon : <span className="size-4" />}
            <span>{label}</span>
        </button>
    );
}

function AssetCard({
    asset,
    onOpen,
    onEdit,
    onCopy,
    onDownload,
    onDelete,
    onContextMenu,
}: {
    asset: DisplayAsset;
    onOpen: () => void;
    onEdit: () => void;
    onCopy: (asset: DisplayAsset) => void;
    onDownload: (asset: DisplayAsset) => void;
    onDelete: () => void;
    onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
}) {
    const cover = asset.coverUrl || (asset.kind === "image" ? asset.data.dataUrl : "");
    const summary = assetSummary(asset);
    return (
        <div onContextMenu={onContextMenu}>
        <Card hoverable className="overflow-hidden" styles={{ body: { padding: 0 } }} cover={<button type="button" className="block w-full text-left" onClick={onOpen}>{cover ? <img src={cover} alt={asset.title} className="aspect-[4/3] w-full object-cover" /> : <div className="flex aspect-[4/3] items-center justify-center bg-stone-100 p-5 text-center text-sm leading-6 text-stone-600 dark:bg-stone-900 dark:text-stone-300">{asset.kind === "text" ? asset.data.content : asset.kind === "audio" ? "音频素材" : "暂无封面"}</div>}</button>}>
            <button type="button" className="block w-full text-left" onClick={onOpen}>
                <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <h2 className="line-clamp-1 text-sm font-semibold text-stone-950 dark:text-stone-100">{asset.title}</h2>
                            <Typography.Text type="secondary" className="mt-1 block text-xs">{asset.source || "未标注来源"}</Typography.Text>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                            <Tag className="m-0 text-[11px]">{assetKindLabel(asset.kind)}</Tag>
                            <Tag className="m-0 text-[11px]" color={assetSourceTone(asset)}>{assetSourceLabel(asset)}</Tag>
                        </div>
                    </div>
                    <Typography.Paragraph type="secondary" ellipsis={{ rows: 3 }} className="!mb-0 !mt-2 !text-xs !leading-5">{summary}</Typography.Paragraph>
                    <div className="mt-3 flex flex-wrap gap-1.5">{(asset.tags || []).slice(0, 3).map((tag) => <Tag key={tag} className="m-0 text-[11px]">{tag}</Tag>)}{!asset.tags?.length ? <Tag className="m-0 text-[11px]">无标签</Tag> : null}</div>
                </div>
            </button>
            <div className="flex flex-wrap items-center gap-2 px-4 pb-4">
                <Button size="small" onClick={onOpen}>查看</Button>
                {!asset.readonly && asset.kind !== "video" && asset.kind !== "audio" ? <Button size="small" icon={<PencilLine className="size-3.5" />} onClick={onEdit}>编辑</Button> : null}
                {asset.kind === "text" ? <Button size="small" icon={<Copy className="size-3.5" />} onClick={() => void onCopy(asset)}>复制</Button> : null}
                {asset.kind === "image" || asset.kind === "video" || asset.kind === "audio" ? <Button size="small" icon={<Download className="size-3.5" />} onClick={() => onDownload(asset)}>下载</Button> : null}
                <Button size="small" danger icon={<Trash2 className="size-3.5" />} onClick={onDelete}>删除</Button>
            </div>
        </Card>
        </div>
    );
}

function AssetDrawer({ asset, onClose, onCopy, onDownload }: { asset: DisplayAsset | null; onClose: () => void; onCopy: (asset: DisplayAsset) => void; onDownload: (asset: DisplayAsset) => void }) {
    const cover = asset ? asset.coverUrl || (asset.kind === "image" ? asset.data.dataUrl : "") : "";
    const sourceInfo = asset ? canvasSourceInfo(asset) : null;
    return (
        <Drawer title="素材详情" open={Boolean(asset)} size="large" onClose={onClose}>
            {asset ? (
                <div className="space-y-5">
                    {cover ? <Image src={cover} alt={asset.title} className="rounded-lg" /> : <div className="rounded-lg border border-stone-200 bg-stone-50 p-5 text-sm leading-6 text-stone-600 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300">{asset.kind === "text" ? asset.data.content : asset.kind === "audio" ? "音频素材" : "暂无封面"}</div>}
                    <div>
                        <Typography.Title level={4} className="!mb-2">{asset.title}</Typography.Title>
                        <Space size={[4, 4]} wrap><Tag>{assetKindLabel(asset.kind)}</Tag>{asset.readonly ? <Tag color="blue">后端素材库</Tag> : <Tag>本地收藏</Tag>}{(asset.tags || []).map((tag) => <Tag key={tag}>{tag}</Tag>)}</Space>
                    </div>
                    <div className="rounded-lg border border-stone-200 p-4 dark:border-stone-800">
                        <Typography.Text type="secondary" className="block text-xs">内容</Typography.Text>
                        {asset.kind === "text" ? <Typography.Paragraph className="mt-2 whitespace-pre-wrap">{asset.data.content}</Typography.Paragraph> : asset.kind === "video" ? <video src={asset.data.url} controls className="mt-2 aspect-video w-full rounded-lg bg-black" /> : asset.kind === "audio" ? <audio src={asset.data.url} controls className="mt-3 w-full" /> : <Typography.Text className="mt-2 block">{asset.data.width}x{asset.data.height} · {formatBytes(asset.data.bytes)} · {asset.data.mimeType}</Typography.Text>}
                    </div>
                    {sourceInfo ? (
                        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-100">
                            <div className="font-medium">来自画布素材</div>
                            <div className="mt-1 text-xs opacity-80">{sourceInfo.nodeId ? `节点：${sourceInfo.nodeId}` : "已记录画布来源"}</div>
                            <Button className="mt-3" size="small" icon={<ExternalLink className="size-3.5" />} href={sourceInfo.href}>
                                回到来源画布
                            </Button>
                        </div>
                    ) : null}
                    {asset.note ? <div><Typography.Text type="secondary">备注</Typography.Text><Typography.Paragraph className="mt-1">{asset.note}</Typography.Paragraph></div> : null}
                    <Space>{asset.kind === "text" ? <Button type="primary" icon={<Copy className="size-4" />} onClick={() => onCopy(asset)}>复制文本</Button> : null}{asset.kind === "image" || asset.kind === "video" || asset.kind === "audio" ? <Button type="primary" icon={<Download className="size-4" />} onClick={() => onDownload(asset)}>{asset.kind === "video" ? "下载视频" : asset.kind === "audio" ? "下载音频" : "下载图片"}</Button> : null}</Space>
                </div>
            ) : null}
        </Drawer>
    );
}

function libraryItemToAsset(item: AssetLibraryItem): DisplayAsset {
    const kind = item.type;
    const base = {
        id: `library:${item.id}`,
        backendId: item.id,
        readonly: true,
        kind,
        title: item.title || "未命名素材",
        coverUrl: item.coverUrl || item.url,
        tags: item.tags || [],
        source: item.category || "素材库",
        note: item.description,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        metadata: {
            source: item.sourceType || "backend-assets",
            backendId: item.id,
            prompt: item.prompt || item.description,
            model: item.model,
            canvasId: item.canvasId,
            nodeId: item.nodeId,
            storageKey: item.storageKey,
        },
    };
    if (kind === "text") return { ...base, kind: "text", data: { content: item.content || item.description || item.title } };
    if (kind === "video") return { ...base, kind: "video", data: { url: item.url, storageKey: undefined, width: 0, height: 0, bytes: 0, mimeType: "video/mp4" } };
    if (kind === "audio") return { ...base, kind: "audio", data: { url: item.url, storageKey: undefined, bytes: 0, mimeType: "audio/mpeg" } };
    return { ...base, kind: "image", data: { dataUrl: item.url || item.coverUrl, storageKey: undefined, width: 0, height: 0, bytes: 0, mimeType: "image/png" } };
}

function dedupeAssets(items: DisplayAsset[]) {
    const seen = new Set<string>();
    return items.filter((item) => {
        const key = item.backendId || item.id;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function assetSummary(asset: DisplayAsset) {
    if (asset.kind === "text") return asset.data.content;
    if (asset.kind === "audio") return asset.note || `${asset.data.mimeType} · ${formatBytes(asset.data.bytes)}`;
    return asset.note || `${asset.data.width || "-"}x${asset.data.height || "-"} · ${asset.data.mimeType}`;
}

function assetSearchText(asset: DisplayAsset) {
    return [asset.title, asset.source || "", asset.note || "", (asset.tags || []).join(" "), asset.kind === "text" ? asset.data.content : asset.data.mimeType].join(" ").toLowerCase();
}

function assetKindLabel(kind: AssetKind) {
    return kind === "image" ? "图片" : kind === "video" ? "视频" : kind === "audio" ? "音频" : "文本";
}

function assetSourceLabel(asset: DisplayAsset) {
    const source = String(asset.metadata?.source || asset.source || "").toLowerCase();
    if (source.includes("canvas") || asset.source === "Canvas" || asset.source === "画布") return "来自画布";
    if (asset.readonly || source.includes("backend")) return "后端库";
    return "本地";
}

function assetSourceTone(asset: DisplayAsset) {
    const label = assetSourceLabel(asset);
    if (label === "来自画布") return "blue";
    if (label === "后端库") return "purple";
    return "default";
}

function canvasSourceInfo(asset: DisplayAsset) {
    const metadata = asset.metadata || {};
    const canvasId = typeof metadata.canvasId === "string" ? metadata.canvasId : "";
    const nodeId = typeof metadata.nodeId === "string" ? metadata.nodeId : "";
    if (!canvasId) return null;
    const params = nodeId ? `?nodeId=${encodeURIComponent(nodeId)}` : "";
    return { canvasId, nodeId, href: `/canvas/${encodeURIComponent(canvasId)}${params}` };
}
