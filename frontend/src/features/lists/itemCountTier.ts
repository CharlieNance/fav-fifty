/** The product's namesake cap — mirrors the backend's ListFullError threshold. */
export const MAX_ITEMS = 50

/**
 * How far along a list is toward its fifty, bucketed for the index's count
 * badge (ItemCountBadge): `low` 0–10, `mid` 11–25, `high` 26–49, `full` 50.
 */
export type ItemCountTier = 'low' | 'mid' | 'high' | 'full'

export function itemCountTier(count: number): ItemCountTier {
  if (count >= MAX_ITEMS) return 'full'
  if (count > 25) return 'high'
  if (count > 10) return 'mid'
  return 'low'
}
