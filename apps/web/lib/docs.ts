import { readRepoFile } from './repo'

/**
 * The documentation set, rendered straight from docs/ at the repository root.
 *
 * The site holds no copy of its own. The page you read here and the file a
 * reviewer reads in the repository are the same bytes, so the published
 * documentation cannot drift from the documentation that ships with the code.
 * That matters more than usual for a project whose threat model is a
 * deliverable.
 */
export interface DocMeta {
  readonly slug: string
  readonly file: string
  readonly title: string
  /**
   * The header's name for it, which is shorter than the title on purpose.
   *
   * Four full titles do not fit across a phone, and a nav that scrolls sideways
   * with no visible affordance is a nav whose last two items nobody finds. The
   * short form is written out here rather than derived, because truncating
   * "Entropy and seed generation" by rule gives "Entropy and seed..." and by
   * hand gives "Entropy".
   */
  readonly navLabel: string
  readonly summary: string
  /** The question a reader actually arrived with. */
  readonly question: string
}

export const DOCS: readonly DocMeta[] = [
  {
    slug: 'threat-model',
    navLabel: 'Threats',
    file: 'docs/THREAT-MODEL.md',
    title: 'Threat model',
    summary:
      'What the device defends against, what it partially defends against, and the long list of what it does not, including what an air gap cannot do for you. Read this before trusting it with anything.',
    question: 'What is this safe against, and what is it not?',
  },
  {
    slug: 'verification',
    navLabel: 'Check it',
    file: 'docs/VERIFICATION.md',
    title: 'Checking and building a device',
    summary:
      'How to check, yourself, that a device runs the code it claims to, and how to build one that a stranger can check. Written for someone who does not trust this project and should not have to.',
    question: 'How do I check the device is honest, and build one?',
  },
  {
    slug: 'using',
    navLabel: 'Using it',
    file: 'docs/USING.md',
    title: 'Using the device',
    summary:
      'What each screen is for, what it refuses, and why, including running several devices as one multisig quorum and getting data across the gap. The other pages answer whether this is safe and how to check it; this one answers what happens when you press the thing.',
    question: 'What are the screens, and what does each one refuse?',
  },
  {
    slug: 'entropy',
    navLabel: 'Entropy',
    file: 'docs/ENTROPY.md',
    title: 'Entropy and seed generation',
    summary:
      'The dice procedure, the exact byte encoding, and a worked example you can reproduce with sha256sum on any machine.',
    question: 'How do dice become a seed, and how do I check it?',
  },
]

export function docBySlug(slug: string): DocMeta | undefined {
  return DOCS.find((d) => d.slug === slug)
}

export function readDoc(meta: DocMeta): string {
  return readRepoFile(meta.file)
}
