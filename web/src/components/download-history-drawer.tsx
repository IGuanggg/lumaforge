"use client";

import { useEffect, useState } from "react";
import { Button, Empty, Modal, Tag, Typography } from "antd";
import { FolderOpen } from "lucide-react";

import { clearDownloadHistory, DOWNLOAD_HISTORY_EVENT, getDownloadHistory, openSavedFileLocation, type DownloadHistoryItem } from "@/services/api/downloads";

type DownloadHistoryDrawerProps = {
    open: boolean;
    onClose: () => void;
};

export function DownloadHistoryDrawer({ open, onClose }: DownloadHistoryDrawerProps) {
    const [items, setItems] = useState<DownloadHistoryItem[]>([]);

    useEffect(() => {
        const syncHistory = () => setItems(getDownloadHistory());
        syncHistory();
        window.addEventListener(DOWNLOAD_HISTORY_EVENT, syncHistory);
        return () => window.removeEventListener(DOWNLOAD_HISTORY_EVENT, syncHistory);
    }, []);

    return (
        <Modal
            title="最近下载"
            open={open}
            centered
            width={560}
            footer={null}
            onCancel={onClose}
            styles={{ body: { maxHeight: "70vh", overflowY: "auto" } }}
        >
            <div className="mb-3 flex items-center justify-end gap-2">
                {items.length ? (
                    <Button
                        size="small"
                        danger
                        onClick={() => {
                            clearDownloadHistory();
                            setItems([]);
                        }}
                    >
                        清空
                    </Button>
                ) : null}
                <Button size="small" aria-label="关闭下载记录" onClick={onClose}>
                    关闭
                </Button>
            </div>
            {items.length ? (
                <div className="space-y-3">
                    {items.map((item) => (
                        <div key={item.id} className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <Typography.Text strong ellipsis className="block">
                                        {item.filename}
                                    </Typography.Text>
                                    <Typography.Text type="secondary" className="mt-1 block text-xs">
                                        {formatDownloadTime(item.savedAt)}
                                    </Typography.Text>
                                </div>
                                {item.fallback ? <Tag className="m-0">浏览器目录</Tag> : <Tag className="m-0" color="blue">已选位置</Tag>}
                            </div>
                            <Typography.Paragraph type="secondary" ellipsis={{ rows: 2 }} className="!mb-0 !mt-2 !text-xs">
                                {item.path || "已交给浏览器下载，请查看浏览器默认下载目录"}
                            </Typography.Paragraph>
                            {item.path ? (
                                <Button size="small" className="mt-3" icon={<FolderOpen className="size-3.5" />} onClick={() => void openSavedFileLocation(item.path!)}>
                                    打开所在文件夹
                                </Button>
                            ) : null}
                        </div>
                    ))}
                </div>
            ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无下载记录" />
            )}
        </Modal>
    );
}

function formatDownloadTime(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString("zh-CN", { hour12: false });
}
