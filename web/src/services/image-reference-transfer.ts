import type { ReferenceImage } from "@/types/image";

const IMAGE_REFERENCE_TRANSFER_KEY = "lumaforge:pending-image-reference:v1";

export function queueImageReference(reference: ReferenceImage) {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(IMAGE_REFERENCE_TRANSFER_KEY, JSON.stringify(reference));
}

export function consumeImageReference() {
    if (typeof window === "undefined") return null;
    const raw = window.sessionStorage.getItem(IMAGE_REFERENCE_TRANSFER_KEY);
    window.sessionStorage.removeItem(IMAGE_REFERENCE_TRANSFER_KEY);
    if (!raw) return null;
    try {
        const reference = JSON.parse(raw) as ReferenceImage;
        return reference?.id && reference?.dataUrl ? reference : null;
    } catch {
        return null;
    }
}
