"use client";

import {useEffect, useState} from "react";

/**
 * The bar rides the flare plane while the hero is on screen, then switches to
 * the dark plane. Without the switch an orange bar sits over black content for
 * the rest of the page and reads as a mistake rather than a decision.
 *
 * The links are always rendered; only the surface colour depends on scroll.
 */
export function Nav() {
  const [past, setPast] = useState(false);

  useEffect(() => {
    const onScroll = () => setPast(window.scrollY > window.innerHeight * 0.62);
    onScroll();
    window.addEventListener("scroll", onScroll, {passive: true});
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav className={past ? "nav dark" : "nav"}>
      <span className="wordmark">LADING</span>
      <div className="nav-right">
        <a className="label" href="#book">
          Live book
        </a>
        <a className="label" href="#faq">
          FAQ
        </a>
      </div>
    </nav>
  );
}
