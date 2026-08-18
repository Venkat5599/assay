"use client";

import {useEffect} from "react";
import Lenis from "lenis";
import {gsap} from "gsap";
import {ScrollTrigger} from "gsap/ScrollTrigger";

/**
 * The motion layer.
 *
 * One hard rule governs everything here: nothing on this page is hidden and
 * then revealed. Every element animated below is already painted at full
 * opacity by the server render. If this component never mounts - no JS, a
 * hydration hiccup, reduced motion, a screenshot pass - the page is complete
 * and readable. Motion adds; it never gates.
 *
 * So there are no entrance reveals. What moves is what is already on screen:
 * parallax between layers, a marquee that responds to scroll velocity, figures
 * that count, and the settlement map advancing as you travel past it.
 */
export function Motion() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    gsap.registerPlugin(ScrollTrigger);

    const lenis = new Lenis({
      duration: 1.05,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
    });

    lenis.on("scroll", ScrollTrigger.update);

    const raf = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(raf);
    gsap.ticker.lagSmoothing(0);

    const ctx = gsap.context(() => {
      // --- Hero parallax. Three layers travelling at three rates, so the fold
      //     has depth rather than sliding as one flat sheet.
      const heroPlate = document.querySelector(".hero-plate");
      const heroCopy = document.querySelector(".hero-inner > div");

      if (heroPlate) {
        gsap.to(heroPlate, {
          yPercent: 14,
          ease: "none",
          scrollTrigger: {trigger: ".hero", start: "top top", end: "bottom top", scrub: 0.6},
        });
      }
      if (heroCopy) {
        gsap.to(heroCopy, {
          yPercent: -7,
          ease: "none",
          scrollTrigger: {trigger: ".hero", start: "top top", end: "bottom top", scrub: 0.6},
        });
      }

      // --- Figures count to the value already in the DOM. The text starts at
      //     its true value, so a failed animation leaves the correct number.
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
          trigger: el,
          start: "top 88%",
          once: true,
          onEnter: () =>
            gsap.to(obj, {
              v: target,
              duration: 1.1,
              ease: "power2.out",
              onUpdate: () => {
                el.textContent =
                  prefix +
                  obj.v.toLocaleString("en-US", {
                    minimumFractionDigits: decimals,
                    maximumFractionDigits: decimals,
                  }) +
                  suffix;
              },
              onComplete: () => {
                el.textContent = raw;
              },
            }),
        });
      });

      // --- The marquee leans into the direction of travel. It runs on its own
      //     CSS animation regardless; this only bends the rate.
      const tracks = gsap.utils.toArray<HTMLElement>(".ticker-track");
      if (tracks.length) {
        let current = 1;
        ScrollTrigger.create({
          trigger: document.body,
          start: "top top",
          end: "bottom bottom",
          onUpdate: (self) => {
            const target = 1 + Math.min(Math.abs(self.getVelocity()) / 2400, 2.4);
            current += (target - current) * 0.12;
            tracks.forEach((t) => {
              t.style.animationDuration = `${34 / current}s`;
            });
          },
        });
      }

      // --- Section headings drift a little slower than the page. Already
      //     visible; this is depth, not an entrance.
      gsap.utils.toArray<HTMLElement>(".section h2").forEach((el) => {
        gsap.fromTo(
          el,
          {y: 26},
          {
            y: -26,
            ease: "none",
            scrollTrigger: {trigger: el, start: "top bottom", end: "bottom top", scrub: 0.8},
          },
        );
      });

      // --- The settlement map advances through its stages as you pass it.
      const stages = gsap.utils.toArray<HTMLElement>(".stage");
      if (stages.length) {
        ScrollTrigger.create({
          trigger: ".map",
          start: "top 70%",
          end: "bottom 40%",
          onUpdate: (self) => {
            const i = Math.min(stages.length - 1, Math.floor(self.progress * stages.length));
            const el = stages[i];
            if (el && !el.classList.contains("on")) el.dispatchEvent(new Event("mouseenter"));
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
  }, []);

  return null;
}
