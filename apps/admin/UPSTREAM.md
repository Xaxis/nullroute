# Where this code came from

The sign-in flow is not new code. It is the pattern the maintainer already runs
in other projects, copied here so its behaviour is known before it guards
anything, and adapted only where this console differs. When an upstream fix
lands, this table says which file to compare.

| File here                                                                | Source                                                                  | Changed here                                                                                                     |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `src/server/sql.ts`                                                      | Admission, `apps/admission/src/server/db/sql.ts` @ d7d940d (2026-11-18) | A failed rollback destroys the connection instead of returning it to the pool                                    |
| `src/server/auth/codes.ts`, `limits.ts`, `browser.ts`, `flow.ts`         | Admission, `apps/admission/src/server/auth/` @ d7d940d                  | Schema `nullroute`, cookie names, wording                                                                        |
| `src/server/auth/people.ts`                                              | Admission, `apps/admission/src/server/auth/people.ts` @ d7d940d         | `ipPrefix` expands IPv6 before taking the /48 and folds IPv4-mapped addresses into their /24 (see below)         |
| `src/server/auth/sessions.ts`, `viewer.ts`, `mail.ts`                    | Admission, `apps/admission/src/server/auth/` @ d7d940d                  | Owner allowlist instead of accounts; mail styled for nullroute, plus the contact notification                    |
| `src/app/signin/SignInForm.tsx`                                          | Admission, `apps/admission/src/app/signin/SignInForm.tsx` @ d7d940d     | nullroute's tokens and type, no icon library                                                                     |
| `db/migrations/0001_init.sql` (sign-in tables)                           | Admission's auth tables @ d7d940d                                       | Schema `nullroute`; the grant, message and audit tables are new                                                  |
| `src/proxy.ts`                                                           | Overhead, `apps/web/src/proxy.ts` @ f7a16ba (2026-11-18)                | Public paths for this console; the contact endpoint answers other origins itself                                 |
| `src/app/api/auth/code/route.ts` (response padding)                      | sonicwater, `src/app/api/auth/code/route.ts`                            | A 1.2 second floor on every answer, so a stranger's address and the owner's cannot be told apart by timing       |

## A fix that has not gone back upstream yet

`ipPrefix` in Admission (and in Overhead and Overlook, which share it) slices
an IPv6 address as written. `2001:db8::5` and `2001:db8:0:1::5` are in the same
/48 and get different keys, so one network gets more than one rate-limit
bucket, and `::ffff:203.0.113.7` is keyed apart from `203.0.113.7`. The version
here, with its tests in `test/rules.test.ts`, is the one to take back.
