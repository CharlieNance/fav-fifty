/**
 * How far along a list is toward its fifty, bucketed for the index's count
 * badge (ItemCountBadge): `low` 0–10, `mid` 11–25, `high` 26 up to the cap,
 * `full` at the cap. `max` is `max_items_per_list` from the client config store.
 */
export type ItemCountTier = 'low' | 'mid' | 'high' | 'full'

export function itemCountTier(count: number, max: number): ItemCountTier {
  if (count >= max) return 'full'
  if (count > 25) return 'high'
  if (count > 10) return 'mid'
  return 'low'
}
