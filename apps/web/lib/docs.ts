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
   * Six full titles do not fit across a phone, and a nav that scrolls sideways
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
      'What the device defends against, what it partially defends against, and the long list of what it does not. Read this before trusting it with anything.',
    question: 'What is this safe against, and what is it not?',
  },
  {
    slug: 'verification',
    navLabel: 'Verify',
    file: 'docs/VERIFICATION.md',
    title: 'Verification',
    summary:
      'How to check, yourself, that a device runs the code it claims to. Written for someone who does not trust this project and should not have to.',
    question: 'How do I check the device is honest?',
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
  {
    slug: 'air-gap',
    navLabel: 'Air gap',
    file: 'docs/AIR-GAP.md',
    title: 'The air gap',
    summary:
      'How data crosses to a device with no network, what each direction is trusted to do, and the list of attacks an air gap does not stop.',
    question: 'How does anything get on and off this thing?',
  },
  {
    slug: 'fleet',
    navLabel: 'Fleet',
    file: 'docs/FLEET.md',
    title: 'Running several devices',
    summary:
      'Several of these devices holding one multisig wallet between them: setting up the quorum, walking a PSBT between them, and what they deliberately do not do for each other.',
    question: 'How do I use more than one of these together?',
  },
  {
    slug: 'provisioning',
    navLabel: 'Provisioning',
    file: 'docs/PROVISIONING.md',
    title: 'Provisioning a device',
    summary:
      'The hardware, the hardening actually applied (and the standard controls deliberately skipped as theater here), and how to verify an image before and after flashing it.',
    question: 'How do I build and verify the device image?',
  },
]

export function docBySlug(slug: string): DocMeta | undefined {
  return DOCS.find((d) => d.slug === slug)
}

export function readDoc(meta: DocMeta): string {
  return readRepoFile(meta.file)
}
