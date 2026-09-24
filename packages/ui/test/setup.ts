/**
 * Testing Library's waits, sized for the machines this suite actually runs on.
 *
 * waitFor and findBy give up after one second by default. Several screens
 * here work on real timers: the scanner polls the camera every 200ms, so a
 * test that feeds it two frames needs at least two ticks, and under a busy
 * workstation or CI runner those ticks landed past the second and the test
 * failed while the screen was correct. Five seconds is the ceiling for a
 * wait, not its length: a passing test returns the moment its condition holds,
 * so this changes only how long a real failure takes to be reported. It stays
 * well under the fifteen-second test timeout in vitest.config.ts.
 */

import { configure } from '@testing-library/react'

configure({ asyncUtilTimeout: 5_000 })
