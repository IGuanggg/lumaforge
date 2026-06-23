import { FileText, ImagePlus, Images, LayoutTemplate, Maximize2, SlidersHorizontal, Video } from "lucide-react";

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
        slug: "templates",
        label: "画布模板",
        icon: LayoutTemplate,
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
] as const;

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"];
