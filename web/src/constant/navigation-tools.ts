import { FileText, ImagePlus, Images, Maximize2, Settings2, SlidersHorizontal, Video } from "lucide-react";

export const navigationTools = [
    {
        slug: "canvas",
        label: "智能画布",
        icon: Maximize2,
    },
    {
        slug: "image",
        label: "生图工作台",
        icon: ImagePlus,
    },
    {
        slug: "video",
        label: "视频创作台",
        icon: Video,
    },
    {
        slug: "prompts",
        label: "提示词库",
        icon: FileText,
    },
    {
        slug: "assets",
        label: "我的素材",
        icon: Images,
    },
    {
        slug: "api-settings",
        label: "API 设置",
        icon: SlidersHorizontal,
    },
    {
        slug: "app-settings",
        label: "应用设置",
        icon: Settings2,
    },
] as const;

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"];
