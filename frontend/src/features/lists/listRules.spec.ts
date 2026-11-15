import { describe, expect, it } from 'vitest'

import { DEFAULT_LIMITS } from '@/stores/clientConfig'
import { ListError } from './listErrors'
import {
  charLength,
  normalizeTagName,
  normalizeTags,
  validateItemDraft,
  validateTitle,
} from './listRules'

const LIMITS = DEFAULT_LIMITS

/** Run `fn`, expecting a `ListError('invalid')`; return its detail. */
function invalidDetail(fn: () => unknown): string | null {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(ListError)
    expect((error as ListError).kind).toBe('invalid')
    return (error as ListError).detail
  }
  throw new Error('expected a ListError')
}

describe('charLength', () => {
  it('counts code points like Python len(), not UTF-16 units', () => {
    expect('🎸'.length).toBe(2)
    expect(charLength('🎸')).toBe(1)
    expect(charLength('abc')).toBe(3)
  })
})

describe('validateTitle', () => {
  it('trims', () => {
    expect(validateTitle('  Top Albums  ', LIMITS)).toBe('Top Albums')
  })

  it('rejects a blank title with the backend copy', () => {
    expect(invalidDetail(() => validateTitle('   ', LIMITS))).toBe('Title is required.')
  })

  it('allows exactly the limit and rejects one over', () => {
    expect(validateTitle('a'.repeat(200), LIMITS)).toHaveLength(200)
    expect(invalidDetail(() => validateTitle('a'.repeat(201), LIMITS))).toBe(
      'Title must be 200 characters or fewer.',
    )
  })

  it('counts an emoji as one character, as the server does', () => {
    expect(validateTitle('🎸'.repeat(200), LIMITS)).toBe('🎸'.repeat(200))
  })

  it('uses the limits it is given', () => {
    const tight = { ...LIMITS, max_title_length: 3 }
    expect(invalidDetail(() => validateTitle('abcd', tight))).toBe(
      'Title must be 3 characters or fewer.',
    )
  })
})

describe('validateItemDraft', () => {
  it('trims every field and turns blank note/URL into null', () => {
    expect(validateItemDraft({ text: ' A ', note: '  ', image_url: '' }, LIMITS)).toEqual({
      text: 'A',
      note: null,
      image_url: null,
    })
    expect(
      validateItemDraft({ text: 'A', note: ' n ', image_url: ' https://x.test/a.png ' }, LIMITS),
    ).toEqual({ text: 'A', note: 'n', image_url: 'https://x.test/a.png' })
  })

  it.each([
    [{ text: ' ', note: null, image_url: null }, 'Text is required.'],
    [
      { text: 'a'.repeat(501), note: null, image_url: null },
      'Text must be 500 characters or fewer.',
    ],
    [
      { text: 'A', note: 'n'.repeat(2001), image_url: null },
      'Note must be 2000 characters or fewer.',
    ],
    [
      { text: 'A', note: null, image_url: 'javascript:alert(1)' },
      'Image URL must start with http:// or https://.',
    ],
    [
      { text: 'A', note: null, image_url: 'HTTPS://x.test' },
      'Image URL must start with http:// or https://.',
    ],
    [
      { text: 'A', note: null, image_url: `https://${'a'.repeat(2041)}` },
      'Image URL must be 2048 characters or fewer.',
    ],
  ])('rejects %j with the backend copy', (draft, detail) => {
    expect(invalidDetail(() => validateItemDraft(draft, LIMITS))).toBe(detail)
  })
})

describe('normalizeTagName', () => {
  it('trims, collapses whitespace and lower-cases', () => {
    expect(normalizeTagName('  Sci   Fi\t', LIMITS)).toBe('sci fi')
  })

  it.each([
    ['  ', 'Tag is required.'],
    ['a'.repeat(51), 'Tag must be 50 characters or fewer.'],
  ])('rejects %j', (name, detail) => {
    expect(invalidDetail(() => normalizeTagName(name, LIMITS))).toBe(detail)
  })
})

describe('normalizeTags', () => {
  it('dedupes after normalizing, keeping first-seen order', () => {
    expect(normalizeTags(['Music', 'albums', ' music '], LIMITS)).toEqual(['music', 'albums'])
  })

  it('applies the cap after dedup', () => {
    const tight = { ...LIMITS, max_tags_per_list: 2 }
    expect(normalizeTags(['a', 'A', 'b'], tight)).toEqual(['a', 'b'])
    expect(invalidDetail(() => normalizeTags(['a', 'b', 'c'], tight))).toBe(
      'A list can have at most 2 tags.',
    )
  })
})
