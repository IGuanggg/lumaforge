export type OnboardingMilestone = "api" | "generated";

export type OnboardingState = {
    dismissed: boolean;
    milestones: Partial<Record<OnboardingMilestone, boolean>>;
};

const ONBOARDING_KEY = "lumaforge:first-use-checklist:v1";
export const ONBOARDING_EVENT = "lumaforge:onboarding-change";

export function getOnboardingState(): OnboardingState {
    if (typeof window === "undefined") return { dismissed: false, milestones: {} };
    try {
        const stored = JSON.parse(window.localStorage.getItem(ONBOARDING_KEY) || "{}") as Partial<OnboardingState>;
        return { dismissed: Boolean(stored.dismissed), milestones: stored.milestones || {} };
    } catch {
        return { dismissed: false, milestones: {} };
    }
}

export function markOnboardingMilestone(milestone: OnboardingMilestone) {
    if (typeof window === "undefined") return;
    const current = getOnboardingState();
    if (current.milestones[milestone]) return;
    saveOnboardingState({ ...current, milestones: { ...current.milestones, [milestone]: true } });
}

export function dismissOnboardingChecklist() {
    if (typeof window === "undefined") return;
    saveOnboardingState({ ...getOnboardingState(), dismissed: true });
}

function saveOnboardingState(state: OnboardingState) {
    window.localStorage.setItem(ONBOARDING_KEY, JSON.stringify(state));
    window.dispatchEvent(new CustomEvent(ONBOARDING_EVENT));
}
