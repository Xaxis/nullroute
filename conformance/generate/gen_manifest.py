"""manifest-root.json: expected manifests from the shell tools, not from nullroute.

The tree is written to a scratch directory. The manifest is produced by
`LC_ALL=C sort -z | xargs -0 sha256sum` (macOS /sbin/sha256sum, cross-checked
against `shasum -a 256`), and the root is `sha256sum` of the manifest file. A
locale-aware order is produced with `LC_ALL=en_US.UTF-8 sort` and with Node's
Intl.Collator('en-US') for comparison.
"""
import base64, json, os, shutil, subprocess, sys

OUT = sys.argv[1]
TREE = os.path.abspath('manifest-tree')

FILES = {
    'packages/B.txt': b'upper case B\n',
    'packages/a.txt': b'lower case a\n',
    'packages/Zeta/z.ts': b'export const z = 1\n',
    'packages/_private/x.ts': b'export const x = 2\n',
    'packages/alpha.txt': b'alpha\n',
    'packages/alpha-beta.txt': b'alpha-beta\n',
    'packages/alpha/beta.txt': b'alpha/beta\n',
    'packages/alpha_beta.txt': b'alpha_beta\n',
    'packages/alpha10.txt': b'ten\n',
    'packages/alpha9.txt': b'nine\n',
    'packages/émigré.txt': 'NFC path, UTF-8 bytes c3 a9\n'.encode(),
    'packages/with space.txt': b'a space in the path\n',
    'packages/empty': b'',
    'packages/crlf.txt': b'line one\r\nline two\r\n',
    'packages/no-final-newline.txt': b'no newline at the end',
    'spec/binary.bin': bytes(range(256)),
}


def run(cmd, env=None, stdin=None):
    return subprocess.run(cmd, cwd=TREE, env=env, input=stdin, capture_output=True, check=True).stdout


def manifest_for(order_env):
    listing = b''.join(p.encode() + b'\0' for p in FILES)
    ordered = run(['sort', '-z'], env=order_env, stdin=listing)
    a = run(['xargs', '-0', '/sbin/sha256sum'], stdin=ordered)
    b = run(['xargs', '-0', 'shasum', '-a', '256'], stdin=ordered)
    assert a == b, (a, b)
    with open(os.path.join(TREE, '..', 'MANIFEST.tmp'), 'wb') as f:
        f.write(a)
    root = run(['/sbin/sha256sum', os.path.join(TREE, '..', 'MANIFEST.tmp')]).split()[0].decode()
    return a, root


shutil.rmtree(TREE, ignore_errors=True)
for path, data in FILES.items():
    full = os.path.join(TREE, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, 'wb') as f:
        f.write(data)

c_manifest, c_root = manifest_for({**os.environ, 'LC_ALL': 'C'})
loc_manifest, loc_root = manifest_for({**os.environ, 'LC_ALL': 'en_US.UTF-8'})
node = subprocess.run(['node', '-e', 'const p=JSON.parse(process.argv[1]);p.sort(new Intl.Collator("en-US").compare);console.log(JSON.stringify(p))',
                       json.dumps(list(FILES))], capture_output=True, text=True, check=True).stdout
icu_order = json.loads(node)
c_order = [ln.split('  ', 1)[1] for ln in c_manifest.decode().splitlines()]
icu_manifest = ''.join(next(ln + '\n' for ln in c_manifest.decode().splitlines() if ln.split('  ', 1)[1] == p) for p in icu_order).encode()
import hashlib
icu_root = hashlib.sha256(icu_manifest).hexdigest()
print('C order:', c_order)
print('macOS en_US.UTF-8 sort differs from C:', loc_manifest != c_manifest)
print('ICU en-US order differs from C:', icu_order != c_order)
assert icu_root != c_root

files = [{'path': p, 'contentBase64': base64.b64encode(d).decode()} for p, d in FILES.items()]
cases = [{
    'id': 'byte-order-tree',
    'operation': 'buildManifest',
    'requirements': ['SP-ATT-2'],
    'level': 'MUST',
    'description': ('Sixteen files under two roots, listed here in no particular order. The paths mix upper and lower '
                    'case, punctuation that sorts before and after "/", digits, a space, and a non-ASCII name. '
                    'The manifest is ordered by path bytes. File contents include an empty file, CRLF line endings '
                    'and every byte value.'),
    'input': {'files': files},
    'expected': {'manifest': c_manifest.decode(), 'root': c_root, 'rootMustNotBe': sorted(set([icu_root, loc_root]) - {c_root})},
    'sources': ["manifest: LC_ALL=C sort -z | xargs -0 sha256sum over the files as written (macOS /sbin/sha256sum and shasum -a 256 agree)",
                'root: sha256sum of the manifest file',
                'rootMustNotBe: the root of the same lines ordered by Intl.Collator("en-US") (ICU in Node ' + subprocess.run(['node', '--version'], capture_output=True, text=True).stdout.strip() + ') and the root from LC_ALL=en_US.UTF-8 sort on macOS: examples of the locale-aware order SP-ATT-2 forbids'],
    'notes': ('macOS `LC_ALL=en_US.UTF-8 sort` ' + ('orders these paths differently from C' if loc_manifest != c_manifest else 'orders these paths the same as C, so ICU is used for the locale example')),
}]
single = {'packages/only.txt': b'one file\n'}
line = hashlib.sha256(single['packages/only.txt']).hexdigest() + '  packages/only.txt\n'
cases.append({
    'id': 'single-file',
    'operation': 'buildManifest',
    'requirements': ['SP-ATT-2'],
    'level': 'MUST',
    'description': 'One file. The manifest is one line ending in LF, and the root is the SHA-256 of that line.',
    'input': {'files': [{'path': 'packages/only.txt', 'contentBase64': base64.b64encode(single['packages/only.txt']).decode()}]},
    'expected': {'manifest': line, 'root': hashlib.sha256(line.encode()).hexdigest()},
    'sources': ["printf 'one file\\n' | sha256sum, and sha256sum of the resulting one-line manifest"],
})
check = subprocess.run(['sh', '-c', "printf 'one file\\n' | /sbin/sha256sum"], capture_output=True, text=True).stdout.split()[0]
assert line.startswith(check)
doc = json.load(open(f'{OUT}/manifest-root.json'))
doc['cases'] = cases
json.dump(doc, open(f'{OUT}/manifest-root.json', 'w'), indent=2, ensure_ascii=False)
open(f'{OUT}/manifest-root.json', 'a').write('\n')
print('manifest-root.json', len(cases), c_root)
