"""Re-pin signer-profile vectors in the nullroute specs that declare them.

`make verify` checks every `vectors:` entry in packages/**/*.spec.yaml against
the file's SHA-256. After regenerating, this rewrites the `sha256:` line that
follows each `file: spec/vectors/signer-profile/...` line, and nothing else, so
the re-pin shows up as a plain diff to review.
"""
import glob, hashlib, re, sys

ROOT = sys.argv[1]
changed = 0
for spec in sorted(glob.glob(f'{ROOT}/packages/**/*.spec.yaml', recursive=True)):
    lines = open(spec).read().split('\n')
    for i, line in enumerate(lines):
        m = re.match(r'^(\s*)file: (spec/vectors/signer-profile/\S+)$', line)
        if not m:
            continue
        digest = hashlib.sha256(open(f'{ROOT}/{m.group(2)}', 'rb').read()).hexdigest()
        nxt = lines[i + 1]
        assert re.match(r'^\s*sha256: [0-9a-f]{64}$', nxt), f'{spec}: no sha256 line after {m.group(2)}'
        new = f'{m.group(1)}sha256: {digest}'
        if nxt != new:
            lines[i + 1] = new
            changed += 1
    open(spec, 'w').write('\n'.join(lines))
print(f'pin_specs: {changed} pins updated')
