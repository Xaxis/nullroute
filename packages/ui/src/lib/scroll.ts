import { useCallback, useRef } from 'react'

/**
 * Mark a scroller while there is more of it below the fold.
 *
 * WHY THIS IS SCRIPT AND NOT CSS. The panel has no mouse, no scrollbar and no
 * hover, so a region cut off at its bottom edge looks exactly like a region
 * that ends there. `.nr-screen__body` has carried a scroll shadow for that
 * reason from early on, and its comment puts it plainly: "a user sees text that
 * appears to end at the bottom edge and has no reason to swipe". The same
 * argument applies to every scroller nested inside it, and none of them had
 * one. Measured at 800x480: the export tab hid 491px of descriptor, the quorum
 * addresses 399px, the wallet list 67px, the entered words 48px.
 *
 * The pure-CSS answer is `.nr-scrolls`, which paints the shadow as the
 * scroller's own background and hides it automatically at an edge. It works,
 * and it is invisible on all four of these, because each has an opaque child
 * over the bottom edge that paints over it. The other pure-CSS answer is a
 * sticky pseudo-element on `animation-timeline: scroll(self block)`, which
 * would be inactive exactly when there is nothing to scroll; it was tried and
 * computes to `opacity: 0` in this Chrome.
 *
 * So the question "is there more below" is answered by the only thing that can
 * actually measure it, and written to the DOM as an attribute for the
 * stylesheet to act on. See `.nr-scrolls::after`.
 *
 * IT MUST NOT LIE IN EITHER DIRECTION. A fade under a list that fits says
 * "there is more" when there is not, which is the same class of defect as a
 * warning nobody can see, one step milder. So this watches three things rather
 * than only the scroll position: the scroll itself, the element's own size, and
 * the size of its contents. A list that grows a row, a card that reflows when
 * the keyboard opens, and a region whose content arrives from the daemon after
 * the first paint all change the answer without anybody scrolling.
 */
export function useMoreBelow(): (node: HTMLElement | null) => void {
  /*
   * A map rather than one slot, so the same callback can mark several
   * scrollers. Three screens have more than one: the attestation split has
   * three, and a single-slot version would detach each as the next attached,
   * leaving all but the last unmarked.
   */
  const attached = useRef(
    new Map<HTMLElement, { observer: ResizeObserver; onScroll: () => void }>()
  )

  const update = useCallback((node: HTMLElement) => {
    // A pixel of slack. Fractional scroll heights are normal at browser zoom
    // and on a high-density panel, so an exact comparison leaves the mark on
    // at the end of every list.
    const more = node.scrollTop + node.clientHeight < node.scrollHeight - 1
    if (more) node.setAttribute('data-more-below', '')
    else node.removeAttribute('data-more-below')
  }, [])

  /*
   * A ref callback rather than a ref plus an effect, so the measurement happens
   * when React attaches the node. An effect would run before the node exists on
   * the first pass of a conditional branch, which is most of these: the export
   * tab and the quorum addresses only mount once a call has returned.
   */
  return useCallback(
    (node: HTMLElement | null) => {
      if (node === null) {
        // React hands back null for a node it is detaching, without saying
        // which. Anything no longer in the document is gone.
        for (const [known, { observer, onScroll }] of attached.current) {
          if (known.isConnected) continue
          observer.disconnect()
          known.removeEventListener('scroll', onScroll)
          attached.current.delete(known)
        }
        return
      }

      const previous = attached.current.get(node)
      if (previous !== undefined) {
        previous.observer.disconnect()
        node.removeEventListener('scroll', previous.onScroll)
      }

      const onScroll = (): void => {
        update(node)
      }
      node.addEventListener('scroll', onScroll, { passive: true })

      // Both the element and its contents: the element resizes when the
      // keyboard opens or a banner appears above it, and the contents resize
      // when a row lands.
      const observer = new ResizeObserver(() => {
        update(node)
      })
      observer.observe(node)
      for (const child of node.children) observer.observe(child)

      attached.current.set(node, { observer, onScroll })
      update(node)
    },
    [update]
  )
}
