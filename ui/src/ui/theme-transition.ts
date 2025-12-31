import type { ThemeMode } from "./theme";

export type ThemeTransitionContext = {
  element?: HTMLElement | null;
  pointerClientX?: number;
  pointerClientY?: number;
};

export type ThemeTransitionOptions = {
  nextTheme: ThemeMode;
  applyTheme: () => void;
  context?: ThemeTransitionContext;
  currentTheme?: ThemeMode | null;
};

type DocumentWithViewTransition = Document & {
  startViewTransition?: (callback: () => void) => { finished: Promise<void> };
};

const clamp01 = (value: number) => {
  if (Number.isNaN(value)) return 0.5;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
};

const hasReducedMotionPreference = () => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ?? false;
};

const cleanupThemeTransition = (root: HTMLElement) => {
  root.classList.remove("theme-transition");
  root.style.removeProperty("--theme-switch-x");
  root.style.removeProperty("--theme-switch-y");
};

export const startThemeTransition = ({
  nextTheme,
  applyTheme,
  context,
  currentTheme,
}: ThemeTransitionOptions) => {
  if (currentTheme === nextTheme) return;

  const documentReference = globalThis.document ?? null;
  if (!documentReference) {
    applyTheme();
    return;
  }

  const root = documentReference.documentElement;
  const document_ = documentReference as DocumentWithViewTransition;
  const prefersReducedMotion = hasReducedMotionPreference();

  const canUseViewTransition =
    Boolean(document_.startViewTransition) && !prefersReducedMotion;

  if (canUseViewTransition) {
    let xPercent = 0.5;
    let yPercent = 0.5;

    if (
      context?.pointerClientX !== undefined &&
      context?.pointerClientY !== undefined &&
      typeof window !== "undefined"
    ) {
      xPercent = clamp01(context.pointerClientX / window.innerWidth);
      yPercent = clamp01(context.pointerClientY / window.innerHeight);
    } else if (context?.element) {
      const rect = context.element.getBoundingClientRect();
      if (
        rect.width > 0 &&
        rect.height > 0 &&
        typeof window !== "undefined"
      ) {
        xPercent = clamp01((rect.left + rect.width / 2) / window.innerWidth);
        yPercent = clamp01((rect.top + rect.height / 2) / window.innerHeight);
      }
    }

    root.style.setProperty("--theme-switch-x", `${xPercent * 100}%`);
    root.style.setProperty("--theme-switch-y", `${yPercent * 100}%`);
    root.classList.add("theme-transition");

    try {
      const transition = document_.startViewTransition?.(() => {
        applyTheme();
      });
      if (transition?.finished) {
        void transition.finished.finally(() => cleanupThemeTransition(root));
      } else {
        cleanupThemeTransition(root);
      }
    } catch {
      cleanupThemeTransition(root);
      applyTheme();
    }
    return;
  }

  applyTheme();
  cleanupThemeTransition(root);
};
