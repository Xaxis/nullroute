/**
 * The smallest viewport any supported panel lays this interface out at.
 *
 * provisioning/units/panels.tsv lists the panels and the scale each is drawn
 * at, and tools/checks/check-screen-fit.mjs measures every screen at each
 * resulting size. The narrowest is 360 wide (HyperPixel 4.0 and the 5 inch
 * Touch Display 2) and the shortest is 480 tall (the 7 inch panel), so this is
 * those two numbers. test/provisioning/panels.test.ts holds it equal to what
 * the table gives, so adding a smaller panel there without measuring it fails
 * a test rather than shipping a layout nobody checked.
 */
export const PANEL_FLOOR = { width: 360, height: 480 } as const

/** Whether a viewport is at least as large as every panel's on both axes. */
export function fitsAPanel(width: number, height: number): boolean {
  return width >= PANEL_FLOOR.width && height >= PANEL_FLOOR.height
}
