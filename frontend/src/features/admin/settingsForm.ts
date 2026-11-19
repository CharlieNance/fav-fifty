/**
 * Pure helpers for the admin Settings page: grouping, labels, and checking what's
 * typed in a row against the setting's type and bounds (the backend checks again).
 */
import type { Setting } from './adminApi'

/** A number input's text, or a checkbox's state. */
export type Draft = string | boolean

export interface DraftCheck {
  /** The value to save, when the draft is valid. */
  value: number | boolean | null
  /** Differs from what the app is using now. */
  changed: boolean
  error: string | null
}

const GROUP_TITLES: Record<string, string> = {
  features: 'Features',
  limits: 'Limits',
  rate_limits: 'Rate limits',
}

function humanize(snake: string): string {
  const words = snake.replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** `limits.max_tags_per_list` → `Max tags per list`. */
export function settingLabel(key: string): string {
  return humanize(key.split('.').pop() ?? key)
}

export interface SettingGroup {
  name: string
  title: string
  settings: Setting[]
}

/** Settings grouped by their first key segment, in the order the backend sent them. */
export function settingGroups(settings: Setting[]): SettingGroup[] {
  const groups = new Map<string, SettingGroup>()
  for (const setting of settings) {
    const name = setting.key.includes('.') ? setting.key.split('.')[0]! : 'general'
    let group = groups.get(name)
    if (!group) {
      group = { name, title: GROUP_TITLES[name] ?? humanize(name), settings: [] }
      groups.set(name, group)
    }
    group.settings.push(setting)
  }
  return [...groups.values()]
}

export function validateDraft(setting: Setting, draft: Draft): DraftCheck {
  if (setting.kind === 'bool') {
    const value = Boolean(draft)
    return { value, changed: value !== setting.value, error: null }
  }

  const text = String(draft).trim()
  if (!/^-?\d+$/.test(text)) {
    return { value: null, changed: true, error: 'Enter a whole number.' }
  }
  const value = Number(text)
  const { minimum, maximum } = setting
  if ((minimum !== null && value < minimum) || (maximum !== null && value > maximum)) {
    return {
      value: null,
      changed: true,
      error: `Must be between ${minimum?.toLocaleString()} and ${maximum?.toLocaleString()}.`,
    }
  }
  return { value, changed: value !== setting.value, error: null }
}
