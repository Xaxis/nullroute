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
  readonly summary: string
  /** Shown in the docs index to set expectations before someone clicks. */
  readonly weight: number
}

export const DOCS: readonly DocMeta[] = [
  {
    slug: 'threat-model',
    file: 'docs/THREAT-MODEL.md',
    title: 'Threat model',
    summary:
      'What the device defends against, what it partially defends against, and the long list of what it does not. Read this before trusting it with anything.',
    weight: 1,
  },
  {
    slug: 'verification',
    file: 'docs/VERIFICATION.md',
    title: 'Verification',
    summary:
      'How to check, yourself, that a device runs the code it claims to. Written for someone who does not trust this project and should not have to.',
    weight: 2,
  },
  {
    slug: 'entropy',
    file: 'docs/ENTROPY.md',
    title: 'Entropy and seed generation',
    summary:
      'The dice procedure, the exact byte encoding, and a worked example you can reproduce with sha256sum on any machine.',
    weight: 3,
  },
  {
    slug: 'provisioning',
    file: 'docs/PROVISIONING.md',
    title: 'Provisioning a device',
    summary:
      'The hardware, the hardening actually applied (and the standard controls deliberately skipped as theater here), and how to verify an image before and after flashing it.',
    weight: 4,
  },
]

export function docBySlug(slug: string): DocMeta | undefined {
  return DOCS.find((d) => d.slug === slug)
}

export function readDoc(meta: DocMeta): string {
  return readRepoFile(meta.file)
}
