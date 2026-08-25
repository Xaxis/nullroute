# rpi-image-gen backend

**This backend has still never been run.** `provisioning/profiles/os-signer.yaml`
lists it with `status: planned` and that remains accurate.

What HAS changed is the reason. This file used to say the build needs
`mmdebstrap`, `veritysetup` and `genimage`, which are Linux tools, and that this
repository is developed on macOS. A pinned Linux container is a Linux machine,
and there is one now in `provisioning/build/`, so that excuse is gone. What has
not happened is anybody feeding rpi-image-gen's own recipe to rpi-image-gen.

`provisioning/build/build-system.sh` builds a system partition without it:
mmdebstrap for the root filesystem, erofs for the image, `veritysetup format`
for the hash tree. `make image-repro` builds it twice and asserts one root hash.
That is not this backend, and it does not produce a flashable card. It exists
because the assertions below could be answered without waiting for the whole of
somebody else's build system, and two of them turned out to be wrong.

## What running a build actually found

**There is a third defect, and it is the one that mattered.** The two patches in
`patches/` pin the verity salt and the ext4 hash seed. Both were applied, by
hand, to a real build, and the root hash still moved between two builds of
identical content.

`mkfs.ext4` stamps wall-clock time into three superblock fields, and e2fsprogs
1.47.0 ignores `SOURCE_DATE_EPOCH`. Measured: with the salt pinned, the UUID
pinned and the hash seed pinned, 75 bytes still differed, and they were those
timestamps plus the superblock checksums computed over them. Setting them
afterwards with `debugfs` does not work either: `debugfs` stamps the last write
time again as it closes.

**So the recipe's choice of ext4 is wrong, and it said so itself.** From
`nullroute-signer.yaml`:

> ext4 rather than the erofs default. erofs is the better choice for an
> immutable partition and it is the one whose reproducibility this project has
> not established.

It is established now, in both directions. erofs takes the build time as an
argument, and two builds two seconds apart are byte-for-byte identical.
`rootfs_type` should be erofs, which is also upstream's default and the right
filesystem for a partition that is read-only by design under a hash tree that
already guarantees its integrity.

**And `veritysetup` randomises its own superblock UUID.** Not the root hash,
which is computed over the data, but the hash tree file differs between builds
unless `--uuid` is pinned. The hash tree ships on the card, so it counts.

The mmdebstrap half was fine: two runs produced byte-identical file contents.
Their mtimes differed, which matters for ext4 and not for erofs built with `-T`.

Read `../../README.md` first. A backend in this design is **advisory**. It is a
hint about how to reach the assertions; the verifiers are the contract, and
INV-PROV-2 forbids any verifier from reading a profile's `backends` key at all,
because an abstraction where the backend can influence its own verdict is a claim
rather than an abstraction.

## Why this one

The official Raspberry Pi builder. Its `gpt/ab_userdata` layout already
implements most of what the tier 1 profile asserts: an immutable system partition
with a dm-verity hash tree over it, A/B slots, and a separate persistent data
partition. It is built on `mmdebstrap`, which targets bit-for-bit reproducible
output when `SOURCE_DATE_EPOCH` is set, and it pins packages against
`snapshot.debian.org`.

**Pin the commit, not the tag.** v2.8.0 removed INI configuration support
outright, so this project breaks between minor versions.

## Two upstream defects, and why they are not optional

Both were read out of upstream source, not remembered. Both make the number this
device displays at boot meaningless as a published value, which is the number the
whole project asks a user to compare.

### The verity salt is regenerated on every build

`image/gpt/ab_userdata/pre-image.sh` builds its verity arguments as:

```sh
VERITY_ARGS_SYSTEM="\
 --data-block-size ${IGconf_linux_page_size:-4096} \
 --hash-block-size ${IGconf_linux_page_size:-4096} \
 --hash sha256 \
 --uuid ${VERITY_UUID} \
 --salt $(uuidgen | tr -d '-') \
 --root-hash-file ${IGconf_image_outputdir}/system.roothash"
```

The root hash is a function of (data, salt). With a fresh salt per build, **the
root hash changes on every build even when the filesystem is byte-identical.** A
user comparing the number on the screen against a published release compares two
unrelated numbers, and the comparison that the whole tier 1 story rests on
silently stops meaning anything. Nothing about the output looks wrong.

`patches/0001-pin-verity-salt.patch` replaces the `uuidgen` call with a value the
build is given.

This is also the smaller half of the problem. `--salt` takes 32 bytes; `uuidgen`
produces 16. Whatever libcryptsetup does with the short value, it does the same
way every time, so the defect is the randomness rather than the length, but a
pinned salt should be the full 32 bytes and the patch makes it so.

### The ext4 directory hash seed is regenerated on every build

`mke2fs` is invoked with `-U $SYSTEM_UUID` and whatever
`IGconf_fs_ext4_mkfs_args` holds, and is never given `-E hash_seed=`. Without it
`mke2fs` picks one at random, which changes the bytes of the filesystem while
changing nothing a user can see. It is invisible in a file-level diff of the root
filesystem: two trees compare equal and the images differ.

`patches/0002-pin-ext4-hash-seed.patch` passes a derived seed.

## Where the pinned values come from

`provisioning/checks/identifiers.mjs`, derived from the release version. One
definition with two consumers: this backend sets them, and
`provisioning/checks/image.mjs` checks them. A backend that hard-coded them, or a
profile that listed literal hex, would go stale at the first release nobody
remembered to edit.

```sh
node -e "import('./provisioning/checks/identifiers.mjs').then(m => console.log(m.veritySalt('0.1.0')))"
```

Every value is SHA-256 of a short ASCII string, so a third party recomputes it
with coreutils rather than with our tool:

```sh
printf 'nullroute/verity-salt/0.1.0' | sha256sum
```

## What is unverified here, specifically

Naming it is the point. This list is what somebody running it on Linux is
expected to find wrong.

- **Whether the patches apply.** They are written against the upstream source
  quoted above and have not been fed to `git apply`.
- **Whether the partition names match.** The verifiers match partitions by GPT
  name, and the names in `provisioning/profiles/` are what this backend is
  expected to produce. Upstream's `gpt/ab_userdata` layout has A/B slots, so the
  real names may be `system-a` and `system-b` rather than `system`. If they
  differ, the profile is what changes: the verifier reads the artifact and the
  artifact is right.
- **Whether the config keys are spelled correctly.** The YAML below uses the
  three-section shape upstream's own `config/trixie-minbase.yaml` uses, and the
  variable names come from the shell above, but no build has rejected or accepted
  them.
- **Whether the packages the profile forbids are actually absent.** That is
  INV-PROV-13 and INV-PROV-16, and their verifiers read a root filesystem. They
  will answer it the first time there is one.

## Running it, when there is a Linux machine

```sh
git clone https://github.com/raspberrypi/rpi-image-gen
cd rpi-image-gen
git checkout <the pinned commit>
git apply /path/to/nullroute/provisioning/backends/rpi-image-gen/patches/*.patch

export SOURCE_DATE_EPOCH=$(git -C /path/to/nullroute log -1 --format=%ct)
export NULLROUTE_VERITY_SALT=$(node -e "...")   # see above
export NULLROUTE_EXT4_HASH_SEED=$(node -e "...")

rpi-image-gen build -c /path/to/nullroute/provisioning/backends/rpi-image-gen/nullroute-signer.yaml
```

Then, and this is the part that decides whether any of it worked:

```sh
make verify-image ROOT=work/.../rootfs IMAGE=work/.../nullroute.img
```

Build it twice and pass the second as `COMPARE=` to get the reproducibility
assertion off could-not-run.
