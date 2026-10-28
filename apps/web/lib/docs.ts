import { readRepoFile } from './repo'

/**
 * The documentation set, rendered straight from files in the repository.
 *
 * The site holds no copy of its own. The page you read here and the file a
 * reviewer reads in the repository are the same bytes, so the published
 * documentation cannot drift from the documentation that ships with the code.
 * That matters more than usual for a project whose threat model is a
 * deliverable.
 *
 * EACH FILE IS A CHAPTER AND EACH OF ITS SECTIONS IS A PAGE. The files were
 * published one per page, which made "Using the device" a single 48,000
 * character scroll and gave a reader no map of the whole set. lib/docbook.ts
 * splits every file at its second-level headings, keeping the anchors GitHub
 * gives the whole file, so a link written in the repository still lands on
 * the right paragraph here.
 */
export type DocGroup = 'Start here' | 'Use it' | 'Trust it' | 'Standards' | 'Project'

export const GROUPS: readonly DocGroup[] = [
  'Start here',
  'Use it',
  'Trust it',
  'Standards',
  'Project',
]

export interface DocMeta {
  readonly slug: string
  readonly file: string
  readonly title: string
  readonly group: DocGroup
  /** One sentence for the docs home and the chapter's description. */
  readonly summary: string
  /** Requirement ids (SP-ENT-1) become link targets. The signer profile only. */
  readonly requirements?: boolean
}

export const DOCS: readonly DocMeta[] = [
  {
    slug: 'install',
    file: 'docs/INSTALL.md',
    title: 'Install',
    group: 'Start here',
    summary:
      'Run the whole device on your computer, build or download a card, flash it, and what the device does at first boot.',
  },
  {
    slug: 'using',
    file: 'docs/USING.md',
    title: 'Using the device',
    group: 'Use it',
    summary:
      'Every screen: making a wallet, receiving, signing, multisig, backups, and what the device refuses and why.',
  },
  {
    slug: 'entropy',
    file: 'docs/ENTROPY.md',
    title: 'Entropy and seeds',
    group: 'Use it',
    summary:
      'How dice become a seed, byte for byte, with a worked example you can reproduce with sha256sum.',
  },
  {
    slug: 'threat-model',
    file: 'docs/THREAT-MODEL.md',
    title: 'Threat model',
    group: 'Trust it',
    summary:
      'What the device defends against, what it only mitigates, and what it cannot do, the air gap included.',
  },
  {
    slug: 'verification',
    file: 'docs/VERIFICATION.md',
    title: 'Verification',
    group: 'Trust it',
    summary:
      'Five checks you can run yourself, with or without this project’s tools, and how to build a device a stranger can check.',
  },
  {
    slug: 'security',
    file: 'SECURITY.md',
    title: 'Security policy',
    group: 'Trust it',
    summary:
      'Report a flaw privately through GitHub, acknowledged within 72 hours, and what is in scope.',
  },
  {
    slug: 'signer-profile',
    file: 'spec/signer-profile.md',
    title: 'Signer profile',
    group: 'Standards',
    summary:
      'A draft standard for what any air-gapped signer must show and refuse, written to be met by more than one device.',
    requirements: true,
  },
  {
    slug: 'conformance',
    file: 'conformance/README.md',
    title: 'Conformance kit',
    group: 'Standards',
    summary:
      'Portable test vectors and a runner that holds any signer to the profile through an adapter of its own.',
  },
  {
    slug: 'interop',
    file: 'spec/interop/README.md',
    title: 'Interop fixtures',
    group: 'Standards',
    summary:
      'Real files from Sparrow and Bitcoin Core that the device reads or refuses, and every known gap.',
  },
  {
    slug: 'contributing',
    file: 'CONTRIBUTING.md',
    title: 'Contributing',
    group: 'Project',
    summary:
      'The rules a change is held to: a spec with the code, every invariant bound to a test, and no new dependency without asking.',
  },
]

export function docBySlug(slug: string): DocMeta | undefined {
  return DOCS.find((d) => d.slug === slug)
}

export function docByFile(file: string): DocMeta | undefined {
  return DOCS.find((d) => d.file === file)
}

export function readDoc(meta: DocMeta): string {
  return readRepoFile(meta.file)
}
