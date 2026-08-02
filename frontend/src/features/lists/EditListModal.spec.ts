import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

import { ApiError } from '@/api/client'
import type { ListSummary } from './types'

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>()
  return { ...actual, apiFetch: vi.fn() }
})

import { apiFetch } from '@/api/client'
import EditListModal from './EditListModal.vue'

const apiFetchMock = vi.mocked(apiFetch)

const LIST: ListSummary = {
  id: 'list-1',
  title: 'Best sandwiches',
  status: 'draft',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

describe('EditListModal', () => {
  beforeEach(() => {
    apiFetchMock.mockReset()
  })

  it('pre-fills the title from the given list', () => {
    const wrapper = mount(EditListModal, { props: { list: LIST } })

    expect(wrapper.find<HTMLInputElement>('#edit-list-title').element.value).toBe('Best sandwiches')
  })

  it('Save calls PATCH with the edited title and emits the updated list', async () => {
    const updated = { ...LIST, title: 'Favorite sandwiches' }
    apiFetchMock.mockResolvedValueOnce(updated)
    const wrapper = mount(EditListModal, { props: { list: LIST } })

    await wrapper.find('#edit-list-title').setValue('Favorite sandwiches')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(apiFetchMock).toHaveBeenCalledWith('/lists/list-1', {
      method: 'PATCH',
      body: JSON.stringify({ title: 'Favorite sandwiches' }),
    })
    expect(wrapper.emitted('saved')).toEqual([[updated]])
  })

  it('blocks Save client-side when the title is emptied, without calling the API', async () => {
    const wrapper = mount(EditListModal, { props: { list: LIST } })

    await wrapper.find('#edit-list-title').setValue('   ')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(apiFetchMock).not.toHaveBeenCalled()
    expect(wrapper.emitted('saved')).toBeUndefined()
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
  })

  it('Cancel emits cancel without calling the API', async () => {
    const wrapper = mount(EditListModal, { props: { list: LIST } })

    await wrapper.find('#edit-list-title').setValue('Something else')
    const cancelButton = wrapper.findAll('button').find((b) => b.text() === 'Cancel')
    await cancelButton!.trigger('click')

    expect(apiFetchMock).not.toHaveBeenCalled()
    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })

  it('surfaces a backend error as an inline message without emitting saved', async () => {
    apiFetchMock.mockRejectedValueOnce(new ApiError(404, 'Not found'))
    const wrapper = mount(EditListModal, { props: { list: LIST } })

    await wrapper.find('#edit-list-title').setValue('Renamed')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.emitted('saved')).toBeUndefined()
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
  })
})
