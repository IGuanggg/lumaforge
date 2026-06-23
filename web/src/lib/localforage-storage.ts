import localforage from "localforage";
import type { StateStorage } from "zustand/middleware";

const store = localforage.createInstance({ name: "lumaforge", storeName: "app_state" });
const legacyStore = localforage.createInstance({ name: "infinite-canvas", storeName: "app_state" });

function legacyKey(name: string) {
    return name.startsWith("lumaforge:") ? name.replace(/^lumaforge:/, "infinite-canvas:") : name;
}

export const localForageStorage: StateStorage = {
    getItem: async (name) => {
        if (typeof window === "undefined") return null;
        try {
            const current = await store.getItem<string>(name);
            if (current) return current;
            const oldName = legacyKey(name);
            const legacy = await legacyStore.getItem<string>(oldName);
            if (!legacy) return null;
            await store.setItem(name, legacy);
            await legacyStore.removeItem(oldName);
            return legacy;
        } catch {
            const current = window.localStorage.getItem(name);
            if (current) return current;
            const oldName = legacyKey(name);
            const legacy = window.localStorage.getItem(oldName);
            if (!legacy) return null;
            window.localStorage.setItem(name, legacy);
            window.localStorage.removeItem(oldName);
            return legacy;
        }
    },
    setItem: async (name, value) => {
        if (typeof window === "undefined") return;
        try {
            await store.setItem(name, value);
        } catch {
            window.localStorage.setItem(name, value);
        }
    },
    removeItem: async (name) => {
        if (typeof window === "undefined") return;
        try {
            await store.removeItem(name);
            await legacyStore.removeItem(legacyKey(name));
        } catch {
            window.localStorage.removeItem(name);
        }
    },
};
