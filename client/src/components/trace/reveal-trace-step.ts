/**
 * Reveal a guided step inside PanelBody without scrolling its pinned navigation
 * or a containing mobile drawer. Keep the section heading when it fits together
 * with the active controls and instructions; on short screens prioritize that
 * group, or the focused control when the group itself exceeds the viewport.
 */
export function revealTraceStep(
  section: HTMLElement,
  focusTarget: HTMLElement,
  context: HTMLElement,
): () => void {
  const scroller = section.parentElement;
  let frame = 0;
  const align = () => {
    if (!scroller || !section.isConnected || scroller.clientHeight === 0) return;
    const height = scroller.clientHeight;
    const viewportTop = scroller.getBoundingClientRect().top;
    const contentTop = (element: HTMLElement) =>
      scroller.scrollTop + element.getBoundingClientRect().top - viewportTop;
    const sectionTop = contentTop(section);
    const focusTop = contentTop(focusTarget);
    const focusBottom = focusTop + focusTarget.getBoundingClientRect().height;
    const contextTop = Math.min(contentTop(context), focusTop);
    const contextBottom = Math.max(
      contentTop(context) + context.getBoundingClientRect().height,
      focusBottom,
    );
    const gap = 8;
    const top = contextBottom - contextTop + gap <= height
      ? Math.max(sectionTop, contextBottom - height + gap)
      : Math.max(contextTop, focusBottom - height + gap);

    // Allow even the last short section to reach the top. offsetTop belongs to
    // the positioned panel, not this scroller, and hides content under its index.
    scroller.style.paddingBottom = `${height}px`;
    scroller.scrollTop = Math.max(0, top);
  };

  align();
  // Collapsibles and scroll anchoring can still settle after the React commit.
  // Recheck live rectangles without a smooth scroll racing the next step.
  frame = window.requestAnimationFrame(() => {
    align();
    frame = window.requestAnimationFrame(align);
  });
  return () => window.cancelAnimationFrame(frame);
}
