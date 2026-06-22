"use client";

import { ExternalLink, Plus } from "lucide-react";
import { App, Button, Empty, Input, Modal, Radio, Space, Typography } from "antd";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { useCanvasStore } from "../stores/use-canvas-store";
import { sendGeneratedMediaToCanvas, type CanvasTransferPayload } from "../utils/canvas-transfer";

type SendToCanvasDialogProps = {
    open: boolean;
    payload: CanvasTransferPayload | null;
    onClose: () => void;
};

export function SendToCanvasDialog({ open, payload, onClose }: SendToCanvasDialogProps) {
    const router = useRouter();
    const { message } = App.useApp();
    const projects = useCanvasStore((state) => state.projects);
    const createProject = useCanvasStore((state) => state.createProject);
    const recentProjects = useMemo(() => [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8), [projects]);
    const [selectedId, setSelectedId] = useState<string>("");
    const [creating, setCreating] = useState(false);
    const [newTitle, setNewTitle] = useState("新画布");

    const close = () => {
        setCreating(false);
        setSelectedId("");
        onClose();
    };

    const submit = () => {
        if (!payload) return;
        let canvasId = selectedId || recentProjects[0]?.id;
        if (creating || !recentProjects.length) canvasId = createProject(newTitle.trim() || "新画布");
        if (!canvasId) {
            message.warning("请选择画布，或新建一个画布");
            return;
        }
        try {
            const result = sendGeneratedMediaToCanvas(canvasId, payload);
            message.success("已送入画布，正在定位新节点");
            close();
            router.push(`/canvas/${result.canvasId}?nodeId=${result.nodeId}`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "送入画布失败");
        }
    };

    return (
        <Modal title="送入画布" open={open} onCancel={close} onOk={submit} okText="送入并打开" cancelText="取消" destroyOnHidden>
            <div className="space-y-4 py-2">
                <Typography.Text type="secondary">选择最近使用的画布，或创建一个新画布。插入后会自动定位到新节点。</Typography.Text>
                {recentProjects.length ? (
                    <Radio.Group value={creating ? "__new__" : selectedId || recentProjects[0]?.id} onChange={(event) => { const value = String(event.target.value); setCreating(value === "__new__"); if (value !== "__new__") setSelectedId(value); }} className="w-full">
                        <Space direction="vertical" className="w-full">
                            {recentProjects.map((project) => (
                                <Radio key={project.id} value={project.id} className="w-full rounded-md border border-stone-200 px-3 py-2 dark:border-stone-700">
                                    <span className="font-medium">{project.title}</span>
                                    <span className="ml-2 text-xs text-stone-500">{project.nodes.length} 个节点</span>
                                </Radio>
                            ))}
                            <Radio value="__new__" className="w-full rounded-md border border-stone-200 px-3 py-2 dark:border-stone-700">
                                <span className="inline-flex items-center gap-1.5"><Plus className="size-3.5" />新建画布</span>
                            </Radio>
                        </Space>
                    </Radio.Group>
                ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有画布">
                        <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>新建画布</Button>
                    </Empty>
                )}
                {creating || !recentProjects.length ? <Input value={newTitle} maxLength={40} onChange={(event) => setNewTitle(event.target.value)} placeholder="画布名称" prefix={<ExternalLink className="size-4 text-stone-400" />} /> : null}
            </div>
        </Modal>
    );
}
