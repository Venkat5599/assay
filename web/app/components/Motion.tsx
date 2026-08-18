"use client";

import {useEffect} from "react";
import {usePathname} from "next/navigation";
import Lenis from "lenis";
import {gsap} from "gsap";
import {ScrollTrigger} from "gsap/ScrollTrigger";

/**
 * The motion layer.
 *
 * One hard rule: content is never hidden waiting for an animation. Every
 * element here is painted at full opacity by the server render. If this
 * component never mounts - no JS, reduced motion, a hydration hiccup, a
 * screenshot pass - the page is complete and readable.
 *
 * That rules out the usual opacity-0 entrance. What we do instead is animate
 * a CLIP on already-visible type: the words exist in the DOM at full opacity
 * from the first paint, and the clip simply starts fully open when JS is
 * absent. Motion adds; it never gates.
 *
 * Lenis owns the document scroller, so this runs on the marketing page only -
 * the workstation has its own scroll panes and smooth-scrolling the document
 * there kills the wheel.
 */

const MOTION_KEY = "lading:reduce-motion";

export function prefersReduced(): boolean {
  if (typeof window === "undefined") return false;
  if (window.localStorage.getItem(MOTION_KEY) === "1") return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function Motion() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname !== "/") return;
    if (prefersReduced()) {
      document.documentElement.dataset.reduceMotion = "1";
      return;
    }
    delete document.documentElement.dataset.reduceMotion;

    gsap.registerPlugin(ScrollTrigger);

    const lenis = new Lenis({
      duration: 1.1,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
    });
    lenis.on("scroll", ScrollTrigger.update);

    const raf = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(raf);
    gsap.ticker.lagSmoothing(0);

    const ctx = gsap.context(() => {
      /* --------------------------------------------------- line reveals */
      /**
       * Split a heading into lines and clip each one upward.
       *
       * The text is measured after wrapping, so lines follow the real layout
       * rather than a guess. Each line sits in a mask; the glyphs start
       * translated inside it, never at opacity 0. If the tween never runs the
       * mask has no transform and the line reads normally.
       */
      gsap.utils.toArray<HTMLElement>("[data-lines]").forEach((el) => {
        const text = el.textContent ?? "";
        if (!text.trim()) return;

        // Rebuild as words, measure their tops, then group into lines.
        const words = text.split(/\s+/).filter(Boolean);
        el.textContent = "";
        const spans = words.map((w) => {
          const s = document.createElement("span");
          s.textContent = w;
          s.style.display = "inline-block";
          el.append(s, document.createTextNode(" "));
          return s;
        });

        const lines: HTMLElement[][] = [];
        let lastTop = -Infinity;
        spans.forEach((s) => {
          const top = s.offsetTop;
          if (Math.abs(top - lastTop) > 4) lines.push([]);
          lines[lines.length - 1]!.push(s);
          lastTop = top;
        });

        el.textContent = "";
        const inners: HTMLElement[] = [];
        lines.forEach((group) => {
          const mask = document.createElement("span");
          mask.className = "line-mask";
          const inner = document.createElement("span");
          inner.className = "line-inner";
          inner.textContent = group.map((s) => s.textContent).join(" ");
          mask.append(inner);
          el.append(mask);
          inners.push(inner);
        });

        gsap.from(inners, {
          yPercent: 108,
          duration: 0.85,
          ease: "power3.out",
          stagger: 0.07,
          scrollTrigger: {trigger: el, start: "top 85%", once: true},
        });
      });

      /* ------------------------------------------------- image reveals */
      // The clip opens; the image itself is never transparent.
      gsap.utils.toArray<HTMLElement>("[data-reveal]").forEach((el) => {
        gsap.from(el, {
          clipPath: "inset(0% 0% 100% 0%)",
          duration: 1,
          ease: "power3.out",
          scrollTrigger: {trigger: el, start: "top 88%", once: true},
        });
      });

      /* ------------------------------------------------------ parallax */
      const heroPlate = document.querySelector(".hero-plate");
      const heroCopy = document.querySelector(".hero-inner > div");
      if (heroPlate) {
        gsap.to(heroPlate, {
          yPercent: 16, ease: "none",
          scrollTrigger: {trigger: ".hero", start: "top top", end: "bottom top", scrub: 0.6},
        });
      }
      if (heroCopy) {
        gsap.to(heroCopy, {
          yPercent: -8, ease: "none",
          scrollTrigger: {trigger: ".hero", start: "top top", end: "bottom top", scrub: 0.6},
        });
      }

      gsap.utils.toArray<HTMLElement>("[data-parallax]").forEach((el) => {
        const rate = Number(el.dataset.parallax || 10);
        gsap.fromTo(el, {yPercent: rate}, {
          yPercent: -rate, ease: "none",
          scrollTrigger: {trigger: el, start: "top bottom", end: "bottom top", scrub: 0.8},
        });
      });

      /* -------------------------------------------------- pinned panel */
      // The settlement map holds while its stages advance, which is the one
      // place on the page where a sequence genuinely needs the extra dwell.
      const map = document.querySelector<HTMLElement>(".map");
      const stages = gsap.utils.toArray<HTMLElement>(".stage");
      if (map && stages.length && window.innerWidth >= 1000) {
        ScrollTrigger.create({
          trigger: map,
          start: "top 12%",
          end: () => `+=${window.innerHeight * 0.9}`,
          pin: true,
          pinSpacing: true,
          onUpdate: (self) => {
            const i = Math.min(stages.length - 1, Math.floor(self.progress * stages.length));
            const el = stages[i];
            if (el && !el.classList.contains("on")) el.dispatchEvent(new Event("mouseenter"));
          },
        });
      }

      /* ------------------------------------------------------- figures */
      // Counts to the value already in the DOM, and restores the exact string
      // on completion, so a failed tween leaves the correct number.
      gsap.utils.toArray<HTMLElement>(".stat-figure").forEach((el) => {
        const raw = el.textContent ?? "";
        const match = raw.match(/^([^\d-]*)([\d,.]+)(.*)$/);
        if (!match) return;
        const [, prefix, digits, suffix] = match;
        const target = Number(digits!.replace(/,/g, ""));
        if (!Number.isFinite(target) || target === 0) return;
        const decimals = digits!.includes(".") ? (digits!.split(".")[1]?.length ?? 0) : 0;
        const obj = {v: 0};

        ScrollTrigger.create({
          trigger: el, start: "top 88%", once: true,
          onEnter: () =>
            gsap.to(obj, {
              v: target, duration: 1.1, ease: "power2.out",
              onUpdate: () => {
                el.textContent = prefix + obj.v.toLocaleString("en-US", {
                  minimumFractionDigits: decimals, maximumFractionDigits: decimals,
                }) + suffix;
              },
              onComplete: () => { el.textContent = raw; },
            }),
        });
      });

      /* -------------------------------------------------------- marquee */
      const tracks = gsap.utils.toArray<HTMLElement>(".ticker-track");
      if (tracks.length) {
        let current = 1;
        ScrollTrigger.create({
          trigger: document.body, start: "top top", end: "bottom bottom",
          onUpdate: (self) => {
            const target = 1 + Math.min(Math.abs(self.getVelocity()) / 2400, 2.4);
            current += (target - current) * 0.12;
            tracks.forEach((t) => { t.style.animationDuration = `${34 / current}s`; });
          },
        });
      }
    });

    ScrollTrigger.refresh();

    return () => {
      ctx.revert();
      gsap.ticker.remove(raf);
      ScrollTrigger.getAll().forEach((t) => t.kill());
      lenis.destroy();
    };
  }, [pathname]);

  return null;
}

/** Explicit opt-out, persisted. Cuts the scroll work and the GPU cost with it. */
export function ReduceMotionToggle() {
  const set = (on: boolean) => {
    window.localStorage.setItem(MOTION_KEY, on ? "1" : "0");
    window.location.reload();
  };

  return (
    <button
      className="reduce-toggle label"
      onClick={() => set(!prefersReduced())}
      aria-pressed={prefersReduced()}
    >
      {typeof window !== "undefined" && prefersReduced() ? "Motion off" : "Reduce motion"}
    </button>
  );
}
