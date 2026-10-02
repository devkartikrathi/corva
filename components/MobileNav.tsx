"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/** Fired by anything that wants the drawer shut — the close button inside it. */
export const NAV_CLOSE_EVENT = "cv:nav-close";

/**
 * The menu button on a small screen, and the drawer's backdrop.
 *
 * The sidebar itself does not move in the tree: below the breakpoint the
 * stylesheet parks it off-canvas and brings it back when <html> carries
 * `data-nav="open"`. This sets and clears that attribute, so the sidebar and
 * the top bar stay two components that know nothing about each other.
 */
export function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Going somewhere is the reason the drawer was opened; arriving closes it.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    const root = document.documentElement;
    if (open) root.setAttribute("data-nav", "open");
    else root.removeAttribute("data-nav");
    return () => root.removeAttribute("data-nav");
  }, [open]);

  useEffect(() => {
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    // A phone turned sideways, or a window dragged wide, has its sidebar back.
    const wide = window.matchMedia("(min-width: 901px)");
    window.addEventListener(NAV_CLOSE_EVENT, close);
    window.addEventListener("keydown", onKey);
    wide.addEventListener("change", close);
    return () => {
      window.removeEventListener(NAV_CLOSE_EVENT, close);
      window.removeEventListener("keydown", onKey);
      wide.removeEventListener("change", close);
    };
  }, []);

  return (
    <>
      <button
        type="button"
        className="m-only cv-iconbtn"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        aria-controls="cv-sidebar"
        onClick={() => setOpen((v) => !v)}
      >
        <svg width="18" height="14" viewBox="0 0 18 14" aria-hidden="true">
          <path d="M0 1h18M0 7h18M0 13h18" stroke="currentColor" strokeWidth="2" fill="none" />
        </svg>
      </button>
      {open && (
        <button
          type="button"
          className="m-only cv-backdrop"
          aria-label="Close menu"
          tabIndex={-1}
          onClick={() => setOpen(false)}
        />
      )}
    </>
  );
}
