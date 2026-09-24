/**
 * Characters that make text render as something other than what it stores.
 *
 * Spec: core.labels (INV-LABEL-6)
 *
 * A signature commits to bytes and a person agrees to what the screen draws.
 * Anything that lets the two differ, a bidi control that reorders the text, a
 * zero-width character that draws as nothing, a separator the browser draws
 * as a space, is refused in a message and a label and stripped from a wallet
 * name.
 *
 * DEFINED BY UNICODE CATEGORY, NOT BY A LIST. There were three hand-written
 * lists of code points, in the label reader, the message reviewer and the
 * wallet-name stripper, and they drifted: one lost the line separators, and
 * all three missed U+061C, the Arabic letter mark, which is a bidi control of
 * exactly the kind they refused. Every entry on those lists was a control
 * character (Cc), a format character (Cf) or a line or paragraph separator
 * (Zl, Zp), so those four categories are the definition. They also close the
 * siblings nobody had listed: U+180E, U+00AD and U+206A to U+206F.
 */

const CLASS = '\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}'

// Tab and newline stay legal in a message, which is multi-line text a person
// reads, and nowhere else.
const IN_MESSAGE = new RegExp(`(?![\\t\\n])[${CLASS}]`, 'u')
const ANYWHERE = new RegExp(`[${CLASS}]`, 'u')
const ALL = new RegExp(`[${CLASS}]`, 'gu')

/**
 * Whether the text holds a character that does not render as what it is.
 *
 * `allowLineBreaks` permits tab and newline, for a message.
 */
export function hasForgeable(text: string, options: { allowLineBreaks?: boolean } = {}): boolean {
  return (options.allowLineBreaks === true ? IN_MESSAGE : ANYWHERE).test(text)
}

/** The text with every such character removed, for a name that is stripped. */
export function stripForgeable(text: string): string {
  return text.replace(ALL, '')
}
