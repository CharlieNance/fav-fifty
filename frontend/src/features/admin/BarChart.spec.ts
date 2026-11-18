import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import BarChart from './BarChart.vue'

const BARS = [
  { label: 'Nov 16', value: 0 },
  { label: 'Nov 17', value: 4 },
  { label: 'Nov 18', value: 2 },
]

describe('BarChart', () => {
  it('draws a bar per non-zero value, scaled to the largest', () => {
    const wrapper = mount(BarChart, { props: { bars: BARS, title: 'Lists created', height: 40 } })
    const paths = wrapper.findAll('path').map((p) => p.attributes('d'))

    expect(paths[0]).toBe('') // zero draws nothing
    expect(paths[1]).toContain('V2') // the max bar reaches the top (+ corner radius)
    expect(paths[2]).toMatch(/V2[02]/) // half height: top at y=20
  })

  it('names itself for screen readers with the total and the max', () => {
    const wrapper = mount(BarChart, { props: { bars: BARS, title: 'Lists created' } })
    expect(wrapper.find('svg').attributes('aria-label')).toBe(
      'Lists created: 6 in total, up to 4 a bar',
    )
  })

  it('shows the hovered bar’s value', async () => {
    const wrapper = mount(BarChart, { props: { bars: BARS, title: 'Lists created' } })
    expect(wrapper.text()).not.toContain('Nov 17: 4')

    await wrapper.findAll('rect')[1]!.trigger('mouseenter')
    expect(wrapper.text()).toContain('Nov 17: 4')

    await wrapper.find('svg').trigger('mouseleave')
    expect(wrapper.text()).not.toContain('Nov 17: 4')
  })

  it('has every value in a table', () => {
    const wrapper = mount(BarChart, { props: { bars: BARS, title: 'Lists created' } })
    const rows = wrapper.findAll('tbody tr').map((tr) => tr.text())
    expect(rows).toEqual(['Nov 160', 'Nov 174', 'Nov 182'])
    expect(wrapper.find('thead').text()).toContain('Lists created')
  })
})
