import { describe, expect, it } from 'vitest'
import { expandIPv6, ipPrefix, maskEmail, parseCode, parseEmail } from '@/server/auth/people'
import { MIN_ELAPSED_MS, parseContact } from '@/server/contact'
import { daysUntil } from '@/server/grants'
import { compile } from '@/server/sql'
import { contentSecurityPolicy } from '@/proxy'

describe('sign-in input', () => {
  it('normalises an email address and refuses what is not one', () => {
    expect(parseEmail('  Wil@Example.COM ')).toBe('wil@example.com')
    expect(parseEmail('no-at-sign')).toBeUndefined()
    expect(parseEmail('a@b')).toBeUndefined()
    expect(parseEmail(42)).toBeUndefined()
    expect(parseEmail(`${'x'.repeat(65)}@example.com`)).toBeUndefined()
  })

  it('takes exactly six digits, ignoring spaces', () => {
    expect(parseCode('123 456')).toBe('123456')
    expect(parseCode('12345')).toBeUndefined()
    expect(parseCode('1234567')).toBeUndefined()
    expect(parseCode('12345a')).toBeUndefined()
  })

  it('stores a network, never the full address', () => {
    expect(ipPrefix('203.0.113.77')).toBe('203.0.113.0/24')
    expect(ipPrefix('2001:db8:abcd:12::1')).toBe('2001:db8:abcd::/48')
  })

  it('gives every spelling of one network the same key', () => {
    // The same /48, compressed in different places. Sliced as written these were
    // "2001:db8:" and "2001:db8:0", two rate-limit buckets for one network.
    expect(ipPrefix('2001:db8::5')).toBe('2001:db8:0::/48')
    expect(ipPrefix('2001:db8:0:1::5')).toBe('2001:db8:0::/48')
    expect(ipPrefix('2001:0DB8:0000:0001:0000:0000:0000:0005')).toBe('2001:db8:0::/48')
    // An IPv4 client reported in IPv6 form is that IPv4 client.
    expect(ipPrefix('::ffff:203.0.113.77')).toBe('203.0.113.0/24')
    expect(ipPrefix('::1')).toBe('0:0:0::/48')
    expect(ipPrefix('fe80::1%eth0')).toBe('fe80:0:0::/48')
  })

  it('leaves what is not an address alone rather than guessing', () => {
    expect(ipPrefix('local')).toBe('local')
    expect(expandIPv6('1::2::3')).toBeUndefined()
    expect(expandIPv6('1:2:3:4:5:6:7:8:9')).toBeUndefined()
    expect(expandIPv6('12345::1')).toBeUndefined()
    expect(expandIPv6('64:ff9b::192.0.2.1')).toEqual([
      '64',
      'ff9b',
      '0',
      '0',
      '0',
      '0',
      'c000',
      '201',
    ])
  })

  it('masks an address enough to recognise and not enough to harvest', () => {
    expect(maskEmail('william@example.com')).toBe('w•••m@example.com')
  })
})

describe('contact form', () => {
  const person = {
    name: 'Ada',
    email: 'ada@example.com',
    topic: 'question',
    message: 'Does the device work on a Pi 4 with 2 GB?',
    website: '',
    elapsed: MIN_ELAPSED_MS + 1,
  }

  it('accepts a real message and normalises the address', () => {
    expect(parseContact({ ...person, email: ' ADA@example.com ' })).toEqual({
      kind: 'ok',
      contact: {
        name: 'Ada',
        email: 'ada@example.com',
        topic: 'question',
        message: person.message,
      },
    })
  })

  it('treats a filled hidden field or a too-fast send as a bot', () => {
    expect(parseContact({ ...person, website: 'https://spam.example' })).toEqual({ kind: 'bot' })
    expect(parseContact({ ...person, elapsed: 400 })).toEqual({ kind: 'bot' })
    expect(parseContact({ ...person, elapsed: undefined })).toEqual({ kind: 'bot' })
  })

  it('names the field that is wrong', () => {
    expect(parseContact({ ...person, message: 'hi' })).toMatchObject({
      kind: 'invalid',
      field: 'message',
    })
    expect(parseContact({ ...person, topic: 'sales' })).toMatchObject({
      kind: 'invalid',
      field: 'topic',
    })
    expect(parseContact({ ...person, name: '   ' })).toMatchObject({
      kind: 'invalid',
      field: 'name',
    })
    expect(parseContact({ ...person, email: 'nope' })).toMatchObject({
      kind: 'invalid',
      field: 'email',
    })
    expect(parseContact({ ...person, message: 'x'.repeat(5001) })).toMatchObject({
      kind: 'invalid',
      field: 'message',
    })
  })
})

describe('sql', () => {
  it('sends every value as a parameter, never as text', () => {
    const evil = "x'; drop table nullroute.grants; --"
    const q = compile({
      strings: ['select * from t where a = ', ' and b = ', ''],
      values: [evil, 3],
    })
    expect(q.text).toBe('select * from t where a = $1 and b = $2')
    expect(q.params).toEqual([evil, 3])
  })
})

describe('content security policy', () => {
  it('runs only scripts carrying the nonce, and is never framed', () => {
    const csp = contentSecurityPolicy('abc123', false)
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'")
    expect(csp).not.toContain('unsafe-eval')
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("form-action 'self'")
  })
})

describe('deadlines', () => {
  it('counts whole calendar days, whatever the hour', () => {
    const late = new Date('2026-11-20T23:59:00Z')
    expect(daysUntil('2026-11-30', late)).toBe(10)
    expect(daysUntil('2026-11-20', late)).toBe(0)
    expect(daysUntil('2026-11-19', late)).toBe(-1)
  })
})
