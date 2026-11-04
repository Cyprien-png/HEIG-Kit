/**
 * Works around the short viewport of iPhone home-screen apps.
 *
 * Installed on an iPhone with a translucent status bar, the page is laid out from the top of the screen, but iOS
 * hands WebKit a layout viewport shorter by the status bar: `innerHeight`, `100%`, the `vh` units and fixed
 * positioning all stop a status bar's height above the bottom of the screen, while the root background is painted
 * down to the edge. The screen itself knows its height (`screen.height` is the portrait height in CSS pixels, whatever
 * the orientation), so when the viewport plus the top inset is exactly the screen, the body is given the screen's
 * height instead, and the document is kept at its top. Nothing happens in Safari or on a desktop.
 */
export function installViewportFix(): void {
  const root = document.documentElement;
  const standalone = () => matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const apply = () => {
    if (!standalone() || innerWidth > innerHeight) return root.style.removeProperty("--app-height");
    const top = parseFloat(getComputedStyle(root).getPropertyValue("--safe-top")) || 0;
    const missing = screen.height - innerHeight - top;
    // Only the exact signature of the bug: the viewport is the screen minus the top inset, give or take a pixel.
    if (top > 0 && Math.abs(missing) <= 1) root.style.setProperty("--app-height", `${screen.height}px`);
    else root.style.removeProperty("--app-height");
  };
  apply();
  // iOS settles its insets a moment after launch: measure again once the page has loaded.
  addEventListener("load", apply);
  addEventListener("resize", apply);
  addEventListener("orientationchange", () => setTimeout(apply, 50));
  // With the body taller than the layout viewport the document could be scrolled by script (focusing an input):
  // keep it at the top so the header never slides under the status bar.
  addEventListener("scroll", () => {
    if (root.style.getPropertyValue("--app-height") && (scrollY !== 0 || scrollX !== 0)) scrollTo(0, 0);
  });
}
