import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "../canvas/types";
import type { CanvasTemplate, CanvasTemplateCategory, CanvasTemplateDifficulty } from "./types";

type TemplateNode = [id: string, type: CanvasNodeType, title: string, x: number, y: number, prompt?: string];

function template(
    id: string,
    name: string,
    description: string,
    category: CanvasTemplateCategory,
    difficulty: CanvasTemplateDifficulty,
    tags: string[],
    accent: string,
    definitions: TemplateNode[],
    edges: Array<[string, string]>,
): CanvasTemplate {
    const nodes: CanvasNodeData[] = definitions.map(([nodeId, type, title, x, y, prompt]) => ({
        id: `${id}-${nodeId}`,
        type,
        title,
        position: { x, y },
        width: type === CanvasNodeType.Video ? 420 : 340,
        height: type === CanvasNodeType.Audio ? 120 : 240,
        metadata: {
            content: type === CanvasNodeType.Text ? prompt || "" : "",
            prompt: type !== CanvasNodeType.Text ? prompt || "" : undefined,
            promptText: type !== CanvasNodeType.Text ? prompt || "" : undefined,
            status: "idle",
            generationMode: type === CanvasNodeType.Config ? "image" : undefined,
        },
    }));
    const connections: CanvasConnection[] = edges.map(([from, to], index) => ({ id: `${id}-edge-${index + 1}`, fromNodeId: `${id}-${from}`, toNodeId: `${id}-${to}` }));
    return { id, name, description, category, difficulty, tags, accent, canvas: { nodes, connections, viewport: { x: 80, y: 80, k: 0.72 } } };
}

export const canvasTemplates: CanvasTemplate[] = [
    template("character-turnaround", "角色三视图", "从角色设定出发，生成正面、侧面与背面视图。", "character", "beginner", ["角色", "三视图", "一致性"], "#2563eb", [["brief", CanvasNodeType.Text, "角色设定", 0, 180, "写下角色年龄、服装、体型和关键识别特征"], ["front", CanvasNodeType.Image, "正面视图", 440, 0, "角色正面全身，纯色背景"], ["side", CanvasNodeType.Image, "侧面视图", 440, 280, "同一角色侧面全身，保持服装一致"], ["back", CanvasNodeType.Image, "背面视图", 440, 560, "同一角色背面全身，保持比例一致"]], [["brief", "front"], ["brief", "side"], ["brief", "back"]]),
    template("character-expression", "角色表情组", "围绕同一角色快速探索六种核心情绪。", "character", "intermediate", ["表情", "头像", "情绪"], "#db2777", [["source", CanvasNodeType.Image, "角色参考", 0, 240], ["prompt", CanvasNodeType.Text, "表情说明", 400, 240, "开心、愤怒、悲伤、惊讶、困惑、得意，保持人物一致"], ["result", CanvasNodeType.Image, "表情组", 800, 240]], [["source", "prompt"], ["prompt", "result"]]),
    template("product-views", "产品三视图", "为产品方案建立正面、侧面和俯视展示。", "product", "beginner", ["产品", "展示", "三视图"], "#0891b2", [["brief", CanvasNodeType.Text, "产品简报", 0, 200, "描述产品用途、材质、颜色和品牌特征"], ["config", CanvasNodeType.Config, "统一生成配置", 400, 200], ["front", CanvasNodeType.Image, "正面", 800, 0], ["side", CanvasNodeType.Image, "侧面", 800, 280], ["top", CanvasNodeType.Image, "俯视", 800, 560]], [["brief", "config"], ["config", "front"], ["config", "side"], ["config", "top"]]),
    template("product-scenes", "产品场景图", "把产品放入居家、户外与棚拍三种环境。", "product", "intermediate", ["场景", "广告", "产品"], "#ea580c", [["product", CanvasNodeType.Image, "产品参考", 0, 260], ["home", CanvasNodeType.Image, "居家场景", 440, 0, "自然居家环境，柔和日光"], ["outdoor", CanvasNodeType.Image, "户外场景", 440, 280, "城市户外环境，真实光影"], ["studio", CanvasNodeType.Image, "棚拍主视觉", 440, 560, "高级商业棚拍，干净背景"]], [["product", "home"], ["product", "outdoor"], ["product", "studio"]]),
    template("four-seasons", "四季风景", "用同一构图生成春夏秋冬四套气氛。", "scene", "beginner", ["风景", "四季", "概念图"], "#16a34a", [["scene", CanvasNodeType.Text, "场景基准", 0, 280, "固定地点、镜头和构图，只改变季节与天气"], ["spring", CanvasNodeType.Image, "春", 420, 0, "春日新绿与花朵"], ["summer", CanvasNodeType.Image, "夏", 420, 280, "盛夏浓绿与强烈阳光"], ["autumn", CanvasNodeType.Image, "秋", 820, 0, "金黄秋叶与薄雾"], ["winter", CanvasNodeType.Image, "冬", 820, 280, "积雪与冷色晨光"]], [["scene", "spring"], ["scene", "summer"], ["scene", "autumn"], ["scene", "winter"]]),
    template("interior-comparison", "室内方案对比", "从空间照片探索极简、复古与自然风格。", "scene", "intermediate", ["室内", "风格", "方案"], "#7c3aed", [["room", CanvasNodeType.Image, "原始空间", 0, 240], ["minimal", CanvasNodeType.Image, "现代极简", 440, 0], ["retro", CanvasNodeType.Image, "复古现代", 440, 280], ["natural", CanvasNodeType.Image, "自然木质", 440, 560]], [["room", "minimal"], ["room", "retro"], ["room", "natural"]]),
    template("style-variants", "批量风格转换", "一张参考图生成插画、电影与复古印刷版本。", "workflow", "advanced", ["批量", "风格", "参考图"], "#9333ea", [["source", CanvasNodeType.Image, "参考图", 0, 260], ["config", CanvasNodeType.Config, "生成设置", 400, 260], ["illustration", CanvasNodeType.Image, "编辑插画", 800, 0, "编辑插画风格，保留主体结构"], ["cinema", CanvasNodeType.Image, "电影质感", 800, 280, "电影剧照质感，真实光影"], ["print", CanvasNodeType.Image, "复古印刷", 800, 560, "复古丝网印刷，有限色板"]], [["source", "config"], ["config", "illustration"], ["config", "cinema"], ["config", "print"]]),
    template("image-upscale", "图片高清增强", "导入图片后执行高清增强，并保留前后对照。", "workflow", "beginner", ["高清", "修复", "放大"], "#0284c7", [["source", CanvasNodeType.Image, "原图", 0, 180], ["note", CanvasNodeType.Text, "增强要求", 420, 180, "提升清晰度和细节，避免改变人物、构图与颜色"], ["result", CanvasNodeType.Image, "高清结果", 840, 180]], [["source", "note"], ["note", "result"]]),
    template("storyboard", "脚本分镜", "把一段脚本拆成画面提示与视频镜头。", "workflow", "advanced", ["分镜", "脚本", "视频"], "#dc2626", [["script", CanvasNodeType.Text, "脚本", 0, 200, "粘贴场景脚本，并标记角色、动作和对白"], ["shot", CanvasNodeType.Text, "镜头拆解", 400, 200, "拆成远景、中景、近景三个连续镜头"], ["frame", CanvasNodeType.Image, "关键帧", 800, 40], ["video", CanvasNodeType.Video, "动态镜头", 800, 360]], [["script", "shot"], ["shot", "frame"], ["frame", "video"]]),
    template("background-swap", "主体换背景", "保留主体，探索棚拍、自然与未来城市背景。", "workflow", "intermediate", ["换背景", "主体", "合成"], "#ca8a04", [["subject", CanvasNodeType.Image, "主体照片", 0, 240], ["mask", CanvasNodeType.Text, "合成要求", 400, 240, "完整保留主体轮廓、材质与姿态，匹配环境光"], ["studio", CanvasNodeType.Image, "摄影棚", 800, 0], ["nature", CanvasNodeType.Image, "自然环境", 800, 280], ["future", CanvasNodeType.Image, "未来城市", 800, 560]], [["subject", "mask"], ["mask", "studio"], ["mask", "nature"], ["mask", "future"]]),
];
