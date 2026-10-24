"use client";

import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";

/** Honors the operating system's reduced-motion preference for every motion component. */
export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
