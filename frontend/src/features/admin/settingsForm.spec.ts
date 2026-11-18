import { describe, expect, it } from 'vitest'

import { makeSetting } from './adminTestUtils'
import { settingGroups, settingLabel, validateDraft } from './settingsForm'

describe('settingLabel', () => {
  it('turns the last key segment into words', () => {
    expect(settingLabel('limits.max_tags_per_list')).toBe('Max tags per list')
    expect(settingLabel('rate_limits.enabled')).toBe('Enabled')
  })
})

describe('settingGroups', () => {
  it('groups by the first segment, keeping the order it was given', () => {
    const groups = settingGroups([
      makeSetting({ key: 'limits.a' }),
      makeSetting({ key: 'rate_limits.b' }),
      makeSetting({ key: 'limits.c' }),
    ])
    expect(groups.map((g) => [g.title, g.settings.map((s) => s.key)])).toEqual([
      ['Limits', ['limits.a', 'limits.c']],
      ['Rate limits', ['rate_limits.b']],
    ])
  })
})

describe('validateDraft', () => {
  const setting = makeSetting()

  it('accepts a whole number in bounds', () => {
    expect(validateDraft(setting, '40')).toEqual({ value: 40, changed: true, error: null })
  })

  it('says when nothing changed', () => {
    expect(validateDraft(setting, '25')).toEqual({ value: 25, changed: false, error: null })
  })

  it.each(['', '2.5', 'abc', '1e3'])('rejects %j as not a whole number', (text) => {
    expect(validateDraft(setting, text).error).toBe('Enter a whole number.')
  })

  it.each(['0', '201'])('rejects %s as out of bounds', (text) => {
    expect(validateDraft(setting, text).error).toBe('Must be between 1 and 200.')
  })

  it('handles switches', () => {
    const on = makeSetting({ key: 'rate_limits.enabled', kind: 'bool', default: true, value: true })
    expect(validateDraft(on, true)).toEqual({ value: true, changed: false, error: null })
    expect(validateDraft(on, false)).toEqual({ value: false, changed: true, error: null })
  })
})
