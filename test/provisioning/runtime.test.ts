/**
 * Tests for the verifiers that judge a boot console log.
 *
 * WHAT THESE ARE GUARDING. Three assertions in os-signer.yaml are about the
 * running kernel and cannot be read off an artifact at rest. The evidence comes
 * from a booted guest that prints six /proc files and judges nothing; the
 * verdict is reached on the host. So the failure mode to be afraid of is not a
 * missed violation, it is a log that is short, mangled or taken too early being
 * read as a clean device. Every one of those looks exactly like "no swap and no
 * listening sockets", which is a pass.
 *
 * Most of what follows is therefore about refusing to answer, rather than about
 * answering correctly.
 */

import { describe, expect, it } from 'vitest'
import {
  mountOptions,
  noListeningSockets,
  noSwap,
  parseFacts,
} from '../../provisioning/checks/runtime.mjs'

/** A listening row in /proc/net/tcp. Only fields 1 and 3 are read. */
const listening = (address: string): string =>
  `   0: ${address} 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1001 0 4242 1`

const TCP_HEADER = '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt'
const SWAP_HEADER = 'Filename\t\t\t\tType\t\tSize\t\tUsed\t\tPriority'

/**
 * Build a console log the way a boot produces one, decoration included.
 *
 * The kernel timestamp and the `runtime-facts[301]:` prefix are not cosmetic
 * here: the parser deliberately looks for its marker ANYWHERE in a line, and a
 * fixture without the prefix would pass while the real thing failed.
 */
function consoleLog(sections: Record<string, string[]>, options: { truncate?: boolean } = {}) {
  const lines = ['[   96.1] runtime-facts[301]: nullroute-facts: begin']
  for (const [name, rows] of Object.entries(sections)) {
    for (const row of rows) {
      lines.push(`[   96.1] runtime-facts[301]: nullroute-facts ${name}| ${row}`)
    }
    lines.push(
      `[   96.1] runtime-facts[301]: nullroute-facts: section ${name} complete, ${String(rows.length)} line(s)`
    )
  }
  if (options.truncate !== true) {
    lines.push('[   96.1] runtime-facts[301]: nullroute-facts: end')
  }
  return lines.join('\n')
}

/** A device in the state the profile expects. */
const HEALTHY = {
  mountinfo: [
    '25 1 0:23 / /tmp rw,nosuid,nodev,noexec,relatime shared:2 - tmpfs tmpfs rw,size=102400k',
    '26 1 0:24 / /var/tmp rw,nosuid,nodev,noexec,relatime shared:3 - tmpfs tmpfs rw',
    '27 1 0:25 / /run rw,nosuid,nodev,noexec,relatime shared:4 - tmpfs tmpfs rw,mode=755',
  ],
  swaps: [SWAP_HEADER],
  tcp: [TCP_HEADER, listening('0100007F:143C')],
  tcp6: [TCP_HEADER],
  udp: [TCP_HEADER],
  udp6: [TCP_HEADER],
}

const BRIDGE = [{ address: '127.0.0.1', port: 5180, why: 'nullroute-bridge.service' }]

const MOUNTS = {
  mounts: [
    { path: '/tmp', fstype: 'tmpfs', options: ['noexec', 'nosuid', 'nodev'] },
    { path: '/var/tmp', fstype: 'tmpfs', options: ['noexec', 'nosuid', 'nodev'] },
    { path: '/run', fstype: 'tmpfs', options: ['noexec', 'nosuid', 'nodev'] },
  ],
}

describe('a healthy device', () => {
  const facts = parseFacts(consoleLog(HEALTHY))

  it('passes all three', () => {
    expect(mountOptions(facts, MOUNTS).ok).toBe(true)
    expect(noSwap(facts).ok).toBe(true)
    expect(noListeningSockets(facts, { allow: BRIDGE }).ok).toBe(true)
  })

  it('states that it is one sample rather than a continuous guarantee', () => {
    // A verifier whose limit lives only in a comment is a verifier whose limit
    // nobody reads. A socket opened only while signing is not in this log.
    expect(noSwap(facts).limits.join(' ')).toMatch(/one sample/)
  })
})

describe('refusing to answer', () => {
  it('will not read a log that has no end marker', () => {
    // THE ONE THAT MATTERS MOST. A harness timeout cuts the log mid-dump, and a
    // truncated dump has zero swap rows and zero listening sockets, which is
    // indistinguishable from a clean device.
    const facts = parseFacts(consoleLog(HEALTHY, { truncate: true }))
    for (const result of [
      noSwap(facts),
      mountOptions(facts, MOUNTS),
      noListeningSockets(facts, { allow: BRIDGE }),
    ]) {
      expect(result.unavailable).toBe(true)
      expect(result.ok).toBe(false)
    }
  })

  it('will not read a section whose line count disagrees with what arrived', () => {
    // A wrapped or corrupted line parses as nothing and silently shrinks the
    // set. The guest says how many it printed, so the arithmetic catches it.
    const log = [
      'nullroute-facts: begin',
      'nullroute-facts swaps| Filename Type Size Used Priority',
      'nullroute-facts: section swaps complete, 3 line(s)',
      'nullroute-facts: end',
    ].join('\n')
    const result = noSwap(parseFacts(log))
    expect(result.unavailable).toBe(true)
    expect(result.detail).toMatch(/truncated/)
  })

  it('will not read an empty section as an empty file', () => {
    // THE REGRESSION THIS EXISTS FOR, and it was a false pass in the file
    // written to prevent false passes. The dumper skips a /proc file it cannot
    // read and still prints "complete, 0 line(s)", which is well formed and
    // internally consistent, so the line-count guard agrees with it perfectly:
    // zero claimed, zero parsed. no-swap read that as "no swap area is active"
    // and no-listening-sockets as "nothing listens", both green, about a device
    // nothing had looked at.
    //
    // All six files carry at least a header row on a booted system, so zero
    // rows is not a state the device can legitimately be in.
    const log = [
      'nullroute-facts: begin',
      ...['mountinfo', 'swaps', 'tcp', 'tcp6', 'udp', 'udp6'].map(
        (name) => `nullroute-facts: section ${name} complete, 0 line(s)`
      ),
      'nullroute-facts: end',
    ].join('\n')
    const facts = parseFacts(log)
    for (const result of [
      noSwap(facts),
      mountOptions(facts, MOUNTS),
      noListeningSockets(facts, { allow: BRIDGE }),
    ]) {
      expect(result.unavailable).toBe(true)
      expect(result.ok).toBe(false)
    }
  })

  it('reads a log with the carriage returns a serial console actually emits', () => {
    // THE ONE THE FIXTURES COULD NOT HAVE CAUGHT, and it cost a full image
    // build and boot to find. A serial console ends its lines CRLF, so
    // splitting on \n leaves \r on the end of every one, and in JavaScript `.`
    // does not match \r: it is a line terminator like \n. So `(.*)$` matched
    // nothing at all on a real device log. Every section parsed as zero rows
    // against a count the device had printed perfectly correctly, and all three
    // verifiers reported the log as truncated.
    //
    // Forty-five tests passed throughout, because every fixture was built by
    // joining strings with \n. This one is built the way the device writes it.
    const facts = parseFacts(consoleLog(HEALTHY).replace(/\n/g, '\r\n'))
    expect(mountOptions(facts, MOUNTS).ok).toBe(true)
    expect(noSwap(facts).ok).toBe(true)
    expect(noListeningSockets(facts, { allow: BRIDGE }).ok).toBe(true)
  })

  it('will not read a log from a boot that never ran the dumper', () => {
    const result = noSwap(parseFacts('systemd: Started something else.\n'))
    expect(result.unavailable).toBe(true)
  })

  it('never reports could-not-run as a pass', () => {
    const facts = parseFacts('')
    for (const result of [noSwap(facts), noListeningSockets(facts, { allow: BRIDGE })]) {
      // BOTH HALVES, because this test is named for the distinction between
      // them. It asserted only ok:false, which a verifier reporting a plain
      // failure also satisfies, so the one test in this file named for
      // could-not-run was the one not checking for it. Changing `usable` to
      // return a failure instead left it green while its two siblings above
      // caught the change.
      expect(result.ok).toBe(false)
      expect(result.unavailable).toBe(true)
    }
  })
})

describe('listening sockets', () => {
  const withTcp = (rows: string[], extra: Partial<typeof HEALTHY> = {}) =>
    parseFacts(consoleLog({ ...HEALTHY, tcp: [TCP_HEADER, ...rows], ...extra }))

  it('decodes the kernel hex in host byte order', () => {
    // 0100007F is 127.0.0.1 reversed, 143C is 5180. Getting this backwards
    // would report the bridge as listening on 1.0.0.127.
    expect(
      noListeningSockets(withTcp([listening('0100007F:143C')]), { allow: BRIDGE }).detail
    ).toMatch(/127\.0\.0\.1:5180/)
  })

  it('fails a log taken before the permitted listener bound', () => {
    // Without this, the earliest possible sample is the one most likely to
    // pass, which inverts the incentive of the whole check.
    const result = noListeningSockets(withTcp([]), { allow: BRIDGE })
    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(/before the device finished starting/)
  })

  it('fails a wildcard bind even on the permitted port', () => {
    // 0.0.0.0:5180 answers every interface. It is the same port the profile
    // permits, and it is the failure the assertion is actually about.
    const result = noListeningSockets(withTcp([listening('00000000:143C')]), { allow: BRIDGE })
    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(/not loopback/)
  })

  it('fails an unexpected loopback listener', () => {
    // 240D is 9229: node's inspector. It binds loopback and hands over the
    // process, key material included, which is why "loopback only" is not the
    // rule and an enumerated allowance is.
    const result = noListeningSockets(
      withTcp([listening('0100007F:143C'), listening('0100007F:240D')]),
      { allow: BRIDGE }
    )
    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(/9229.*no assertion permits/)
  })

  it('fails a bound UDP socket, which has no listen state to look for', () => {
    const facts = parseFacts(
      consoleLog({
        ...HEALTHY,
        udp: [TCP_HEADER, '  0: 0100007F:0035 00000000:0000 07 0 0 0 1001 0 1 1'],
      })
    )
    expect(noListeningSockets(facts, { allow: BRIDGE }).ok).toBe(false)
  })

  it('reports a socket it cannot decode instead of dropping it', () => {
    // THE REGRESSION THIS EXISTS FOR. An address field of any length other than
    // 8 or 32 characters used to be skipped, so an undecodable listening socket
    // became an absent one and the check passed with "nothing listens".
    const result = noListeningSockets(withTcp([listening('DEADBEEFDEADBEEFDE:143C')]), {
      allow: BRIDGE,
    })
    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(/could not decode/)
  })

  it('reads IPv6 loopback and wildcard as themselves', () => {
    const v6 = (address: string) =>
      parseFacts(consoleLog({ ...HEALTHY, tcp6: [TCP_HEADER, listening(address)] }))
    // ::1, which an earlier zero-compression bug rendered as ":1" and then
    // reported as a routable address that does not exist.
    expect(
      noListeningSockets(v6('00000000000000000000000001000000:143C'), {
        allow: [...BRIDGE, { address: '::1', port: 5180, why: 'test' }],
      }).ok
    ).toBe(true)
    expect(
      noListeningSockets(v6('00000000000000000000000000000000:143C'), { allow: BRIDGE }).detail
    ).toMatch(/:::5180.*not loopback/)
  })

  it('ignores established connections, which are not listeners', () => {
    const established = '   0: 0100007F:143C 0100007F:C000 01 0 0 0 1001 0 1 1'
    const result = noListeningSockets(withTcp([listening('0100007F:143C'), established]), {
      allow: BRIDGE,
    })
    expect(result.ok).toBe(true)
  })
})

describe('swap', () => {
  it('fails when an area is active', () => {
    const facts = parseFacts(
      consoleLog({ ...HEALTHY, swaps: [SWAP_HEADER, '/swapfile file 1048572 0 -2'] })
    )
    const result = noSwap(facts)
    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(/swapfile/)
  })
})

describe('mount options', () => {
  const withMounts = (rows: string[]) => parseFacts(consoleLog({ ...HEALTHY, mountinfo: rows }))

  it('fails when a required flag is absent', () => {
    const result = mountOptions(
      withMounts(['25 1 0:23 / /tmp rw,nosuid,nodev,relatime shared:2 - tmpfs tmpfs rw']),
      { mounts: [{ path: '/tmp', fstype: 'tmpfs', options: ['noexec'] }] }
    )
    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(/missing noexec/)
  })

  it('fails when the mount is absent from a populated table', () => {
    // POPULATED, NOT EMPTY, and the distinction is the point. An empty
    // mountinfo means the device could not read the file, which is
    // could-not-run rather than a missing mount, so testing "absent" with an
    // empty table would assert the wrong outcome and pass for the wrong reason.
    const result = mountOptions(
      withMounts(['25 1 0:23 / /run rw,nosuid,nodev,noexec shared:2 - tmpfs tmpfs rw']),
      { mounts: [{ path: '/tmp', fstype: 'tmpfs', options: ['noexec'] }] }
    )
    expect(result.unavailable).toBeUndefined()
    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(/not mounted at all/)
  })

  it('judges the last mount on a path, not the first', () => {
    // Mounts shadow. A permissive filesystem mounted over the good tmpfs is
    // what a process writing to /tmp actually gets, and reporting the flags of
    // the one underneath would describe a filesystem nobody can reach.
    const result = mountOptions(
      withMounts([
        '25 1 0:23 / /tmp rw,nosuid,nodev,noexec shared:2 - tmpfs tmpfs rw',
        '99 1 0:99 / /tmp rw,relatime shared:9 - ext4 /dev/vdb rw',
      ]),
      { mounts: [{ path: '/tmp', fstype: 'tmpfs', options: ['noexec'] }] }
    )
    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(/ext4, not tmpfs/)
  })

  it('reads per-mount flags, not the superblock options', () => {
    // The superblock here says noexec and the mount does not. Only the mount's
    // own flags are enforced, and /proc/mounts folds the two together, which is
    // why this reads mountinfo.
    const result = mountOptions(
      withMounts(['25 1 0:23 / /tmp rw,nosuid,nodev shared:2 - tmpfs tmpfs rw,noexec']),
      { mounts: [{ path: '/tmp', fstype: 'tmpfs', options: ['noexec'] }] }
    )
    expect(result.ok).toBe(false)
  })

  it('decodes octal escapes in a mount point', () => {
    const result = mountOptions(
      withMounts(['25 1 0:23 / /a\\040b rw,noexec shared:2 - tmpfs tmpfs rw']),
      { mounts: [{ path: '/a b', fstype: 'tmpfs', options: ['noexec'] }] }
    )
    expect(result.ok).toBe(true)
  })
})
