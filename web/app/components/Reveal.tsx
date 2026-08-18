"use client";

import {AnimatePresence, motion, useReducedMotion} from "motion/react";
import type {ReactNode} from "react";

/**
 * Motion primitives for the workstation.
 *
 * Division of labour, per the stack:
 *   Motion  - UI state: screen swaps, palette, rows, toasts.
 *   GSAP    - scroll-driven work on the marketing page.
 *   Lenis   - the scroll itself, feeding ScrollTrigger.
 *
 * One rule holds across all three: nothing is hidden waiting for an animation.
 * Every element below animates from a visible state, so a failed mount leaves
 * a complete, readable page rather than an empty panel.
 */

/** Screen swap. Content is opaque at rest; only position and blur move. */
export function ScreenSwap({keyed, children}: {keyed: string; children: ReactNode}) {
  const reduce = useReducedMotion();
  if (reduce) return <>{children}</>;

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={keyed}
        initial={{opacity: 0.4, y: 6}}
        animate={{opacity: 1, y: 0}}
        exit={{opacity: 0.4, y: -4}}
        transition={{duration: 0.16, ease: [0.2, 0, 0, 1]}}
        style={{display: "flex", flexDirection: "column", gap: "0.25rem"}}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

/** Command palette. Scales from near-full so it never reads as a pop. */
export function Overlay({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const reduce = useReducedMotion();

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="pal-wrap"
          onClick={onClose}
          initial={{opacity: 0}}
          animate={{opacity: 1}}
          exit={{opacity: 0}}
          transition={{duration: 0.12}}
        >
          <motion.div
            className="pal"
            onClick={(e) => e.stopPropagation()}
            initial={reduce ? false : {opacity: 0, y: -8, scale: 0.985}}
            animate={{opacity: 1, y: 0, scale: 1}}
            exit={reduce ? undefined : {opacity: 0, y: -6, scale: 0.99}}
            transition={{duration: 0.16, ease: [0.2, 0, 0, 1]}}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Expand/collapse for drill-downs. Height only; content stays opaque. */
export function Collapse({open, children}: {open: boolean; children: ReactNode}) {
  const reduce = useReducedMotion();
  if (reduce) return open ? <>{children}</> : null;

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          initial={{height: 0, opacity: 0.6}}
          animate={{height: "auto", opacity: 1}}
          exit={{height: 0, opacity: 0.6}}
          transition={{duration: 0.2, ease: [0.2, 0, 0, 1]}}
          style={{overflow: "hidden"}}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
