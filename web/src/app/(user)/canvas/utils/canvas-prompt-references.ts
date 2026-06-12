import type { CanvasPromptReference } from "../types";
import type { CanvasResourceReference } from "./canvas-resource-references";

export function promptReferenceKey(reference: Pick<CanvasPromptReference, "kind" | "nodeId" | "assetId" | "storageKey" | "url" | "label">) {
    return [reference.kind, reference.nodeId || reference.assetId || reference.storageKey || reference.url || reference.label].join("|");
}

export function toPromptReference(reference: CanvasResourceReference): CanvasPromptReference {
    return {
        id: reference.id,
        kind: reference.kind,
        label: reference.label,
        title: reference.title,
        sourceType: reference.sourceType,
        nodeId: reference.nodeId,
        assetId: reference.assetId,
        imageIndex: reference.imageIndex,
        url: reference.url || reference.previewUrl,
        storageKey: reference.storageKey,
        mimeType: reference.mimeType,
        text: reference.text,
        missing: reference.missing,
        ignoredMissing: reference.ignoredMissing,
    };
}

export function mergePromptReferences(...groups: Array<Array<CanvasPromptReference | null | undefined> | null | undefined>) {
    const result: CanvasPromptReference[] = [];
    const seen = new Set<string>();
    groups.flat().forEach((reference) => {
        if (!reference) return;
        const key = promptReferenceKey(reference);
        if (seen.has(key)) return;
        seen.add(key);
        result.push(reference);
    });
    return result;
}

export function upsertPromptReference(current: CanvasPromptReference[] | undefined, reference: CanvasResourceReference) {
    return mergePromptReferences(current || [], [toPromptReference(reference)]);
}

export function removePromptReference(current: CanvasPromptReference[] | undefined, reference: CanvasResourceReference) {
    const removeKey = promptReferenceKey(toPromptReference(reference));
    return (current || []).filter((item) => promptReferenceKey(item) !== removeKey && item.label !== reference.label);
}

export function removePromptReferenceToken(value: string, label: string) {
    const escaped = escapeRegExp(label);
    return value
        .replace(new RegExp(`@?${escaped}(?=\\s|$|\\p{P})`, "gu"), "")
        .replace(/[ \t]{2,}/g, " ")
        .trimStart();
}

export function collectPromptReferencesFromText(prompt: string, savedRefs: CanvasPromptReference[] | undefined, availableRefs: CanvasResourceReference[]) {
    const tokenMap = new Map<string, CanvasPromptReference>();
    const add = (reference: CanvasPromptReference) => {
        tokenMap.set(reference.label, reference);
        tokenMap.set(`@${reference.label}`, reference);
    };
    (savedRefs || []).forEach(add);
    availableRefs.map(toPromptReference).forEach(add);

    const tokens = Array.from(tokenMap.keys()).sort((a, b) => b.length - a.length);
    if (!tokens.length) return [];

    const pattern = new RegExp(`(${tokens.map(escapeRegExp).join("|")})(?=\\s|$|\\p{P})`, "gu");
    const refs: CanvasPromptReference[] = [];
    const seen = new Set<string>();
    for (const match of prompt.matchAll(pattern)) {
        const reference = tokenMap.get(match[1]);
        if (!reference) continue;
        const key = promptReferenceKey(reference);
        if (seen.has(key)) continue;
        seen.add(key);
        refs.push(reference);
    }
    return refs;
}

export function orderPromptReferences(references: CanvasPromptReference[], order: string[] | undefined) {
    if (!order?.length) return references;
    const indexByKey = new Map(order.map((key, index) => [key, index]));
    return [...references].sort((a, b) => {
        const aIndex = indexByKey.get(promptReferenceKey(a));
        const bIndex = indexByKey.get(promptReferenceKey(b));
        if (aIndex == null && bIndex == null) return 0;
        if (aIndex == null) return 1;
        if (bIndex == null) return -1;
        return aIndex - bIndex;
    });
}

export function referenceOrder(references: CanvasPromptReference[]) {
    return references.map(promptReferenceKey);
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
