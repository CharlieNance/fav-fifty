import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'

import { ApiError } from '@/api/client'
import type { ListSummary } from './types'

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>()
  return { ...actual, apiFetch: vi.fn() }
})

import { apiFetch } from '@/api/client'
import ManageTagsModal from './ManageTagsModal.vue'

const apiFetchMock = vi.mocked(apiFetch)

const LIST: ListSummary = {
  id: 'list-1',
  title: 'Best sandwiches',
  status: 'draft',
  tags: ['deli', 'classics'],
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

function tagChips(wrapper: VueWrapper): string[] {
  return wrapper.findAll('li').map((li) => li.text())
}

describe('ManageTagsModal', () => {
  beforeEach(() => {
    apiFetchMock.mockReset()
  })

  it('pre-fills chips from the list', () => {
    const wrapper = mount(ManageTagsModal, { props: { list: LIST } })

    expect(tagChips(wrapper)).toEqual(['deli', 'classics'])
  })

  it('adds a normalized tag as a new chip without calling the API yet', async () => {
    const wrapper = mount(ManageTagsModal, { props: { list: LIST } })

    await wrapper.find('#new-tag').setValue('  Sci-Fi  ')
    await wrapper.find('form').trigger('submit')

    expect(tagChips(wrapper)).toEqual(['deli', 'classics', 'sci-fi'])
    expect(apiFetchMock).not.toHaveBeenCalled()
    expect((wrapper.find('#new-tag').element as HTMLInputElement).value).toBe('')
  })

  it('does not add a duplicate of an existing (normalized) chip', async () => {
    const wrapper = mount(ManageTagsModal, { props: { list: LIST } })

    await wrapper.find('#new-tag').setValue('DELI')
    await wrapper.find('form').trigger('submit')

    expect(tagChips(wrapper)).toEqual(['deli', 'classics'])
  })

  it("removing a chip's × drops it from the set", async () => {
    const wrapper = mount(ManageTagsModal, { props: { list: LIST } })

    const removeButton = wrapper.find('[aria-label="Remove tag deli"]')
    await removeButton.trigger('click')

    expect(tagChips(wrapper)).toEqual(['classics'])
  })

  it('Save PUTs the edited set and emits the updated list', async () => {
    const updated = { ...LIST, tags: ['classics', 'sci-fi'] }
    apiFetchMock.mockResolvedValueOnce(updated)
    const wrapper = mount(ManageTagsModal, { props: { list: LIST } })

    await wrapper.find('[aria-label="Remove tag deli"]').trigger('click')
    await wrapper.find('#new-tag').setValue('sci-fi')
    await wrapper.find('form').trigger('submit')
    const saveButton = wrapper.findAll('button').find((b) => b.text() === 'Save')
    await saveButton!.trigger('click')
    await flushPromises()

    expect(apiFetchMock).toHaveBeenCalledWith('/lists/list-1/tags', {
      method: 'PUT',
      body: JSON.stringify({ tags: ['classics', 'sci-fi'] }),
    })
    expect(wrapper.emitted('saved')).toEqual([[updated]])
  })

  it('Cancel emits cancel without calling the API, discarding in-progress edits', async () => {
    const wrapper = mount(ManageTagsModal, { props: { list: LIST } })

    await wrapper.find('#new-tag').setValue('sci-fi')
    await wrapper.find('form').trigger('submit')
    const cancelButton = wrapper.findAll('button').find((b) => b.text() === 'Cancel')
    await cancelButton!.trigger('click')

    expect(apiFetchMock).not.toHaveBeenCalled()
    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })

  it('surfaces a 422 (over the cap) inline without emitting saved', async () => {
    apiFetchMock.mockRejectedValueOnce(
      new ApiError(422, 'Unprocessable', 'A list can have at most 100 tags.'),
    )
    const wrapper = mount(ManageTagsModal, { props: { list: LIST } })

    const saveButton = wrapper.findAll('button').find((b) => b.text() === 'Save')
    await saveButton!.trigger('click')
    await flushPromises()

    expect(wrapper.emitted('saved')).toBeUndefined()
    expect(wrapper.find('[role="alert"]').text()).toBe('A list can have at most 100 tags.')
  })

  it('allows saving an empty tag set (removing every tag)', async () => {
    const updated = { ...LIST, tags: [] }
    apiFetchMock.mockResolvedValueOnce(updated)
    const wrapper = mount(ManageTagsModal, { props: { list: LIST } })

    await wrapper.find('[aria-label="Remove tag deli"]').trigger('click')
    await wrapper.find('[aria-label="Remove tag classics"]').trigger('click')
    expect(wrapper.text()).toContain('No tags yet.')

    const saveButton = wrapper.findAll('button').find((b) => b.text() === 'Save')
    await saveButton!.trigger('click')
    await flushPromises()

    expect(apiFetchMock).toHaveBeenCalledWith('/lists/list-1/tags', {
      method: 'PUT',
      body: JSON.stringify({ tags: [] }),
    })
    expect(wrapper.emitted('saved')).toEqual([[updated]])
  })
})
