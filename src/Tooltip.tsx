// App-styled tooltips (M8). Every element with a `title` gets a small
// tooltip that fades in after a short pause and fades out again, instead of
// the system's plain one. While the pointer is over an element its `title`
// is moved to `data-tip` (so the system tooltip never shows) and put back
// when the pointer leaves. Page links have no title: they keep their hover cards.
import { useEffect, useRef, useState } from "react";

const SHOW_DELAY = 450;
/** Moving to a neighbour while a tooltip shows: switch at once. */
const SWITCH_DELAY = 40;
const GAP = 6;

interface Tip {
  text: string;
  x: number;
  y: number;
  /** Above the element instead of below (no room below). */
  above: boolean;
}

export function Tooltips() {
  const [tip, setTip] = useState<Tip | null>(null);
  const [visible, setVisible] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let current: HTMLElement | null = null;
    let timer = 0;
    let shown = false;
    // Notices React (or anything) changing the title while it's moved away.
    const observer = new MutationObserver(() => {
      if (!current) return;
      const t = current.getAttribute("title");
      if (t === null) return;
      current.dataset.tip = t;
      current.removeAttribute("title");
      if (shown) place(current);
    });

    function place(el: HTMLElement) {
      const text = el.dataset.tip ?? "";
      if (!text.trim()) return hide();
      const r = el.getBoundingClientRect();
      const above = r.bottom + 40 > window.innerHeight;
      setTip({ text, x: r.left + r.width / 2, y: above ? r.top - GAP : r.bottom + GAP, above });
      setVisible(true);
      shown = true;
    }

    function release() {
      window.clearTimeout(timer);
      observer.disconnect();
      if (current && current.dataset.tip !== undefined && !current.hasAttribute("title")) {
        current.setAttribute("title", current.dataset.tip);
      }
      if (current) delete current.dataset.tip;
      current = null;
    }

    function hide() {
      release();
      setVisible(false);
      shown = false;
    }

    function over(e: PointerEvent) {
      const el = (e.target as Element | null)?.closest?.<HTMLElement>("[title], [data-tip]");
      if (el === current) return;
      const wasShown = shown;
      release();
      if (!el) {
        setVisible(false);
        shown = false;
        return;
      }
      current = el;
      el.dataset.tip = el.getAttribute("title") ?? el.dataset.tip ?? "";
      el.removeAttribute("title");
      observer.observe(el, { attributes: true, attributeFilter: ["title"] });
      if (!wasShown) setVisible(false);
      timer = window.setTimeout(() => current === el && el.isConnected && place(el), wasShown ? SWITCH_DELAY : SHOW_DELAY);
    }

    function leaveWindow(e: PointerEvent) {
      if (!e.relatedTarget) hide();
    }

    document.addEventListener("pointerover", over, true);
    document.addEventListener("pointerout", leaveWindow, true);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("keydown", hide, true);
    document.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      hide();
      document.removeEventListener("pointerover", over, true);
      document.removeEventListener("pointerout", leaveWindow, true);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("keydown", hide, true);
      document.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
    };
  }, []);

  // Keep the box inside the window.
  const [shift, setShift] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el || !tip) return;
    const w = el.offsetWidth;
    const left = tip.x - w / 2;
    setShift(left < 8 ? 8 - left : left + w > window.innerWidth - 8 ? window.innerWidth - 8 - (left + w) : 0);
  }, [tip]);

  if (!tip) return null;
  return (
    <div
      ref={box}
      className={`app-tooltip ${visible ? "visible" : ""} ${tip.above ? "above" : ""}`}
      role="tooltip"
      style={{ left: tip.x + shift, top: tip.y }}
    >
      {tip.text}
    </div>
  );
}
