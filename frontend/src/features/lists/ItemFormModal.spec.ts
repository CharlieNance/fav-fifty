import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

import { ApiError } from '@/api/client'

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>()
  return { ...actual, apiFetch: vi.fn() }
})

import { apiFetch } from '@/api/client'
import ItemFormModal from './ItemFormModal.vue'
import { makeItem } from './itemTestUtils'
import type { ListItem } from './types'

const apiFetchMock = vi.mocked(apiFetch)

function mountModal(item: ListItem | null = null) {
  return mount(ItemFormModal, { props: { listId: 'list-1', item } })
}

describe('ItemFormModal', () => {
  beforeEach(() => {
    apiFetchMock.mockReset()
  })

  describe('add mode', () => {
    it('renders an empty form with the add heading', () => {
      const wrapper = mountModal()

      expect(wrapper.text()).toContain('Add an item')
      expect((wrapper.find('#item-text').element as HTMLInputElement).value).toBe('')
    })

    it('POSTs the trimmed draft (blank optionals as null) and emits saved', async () => {
      const created = makeItem({ text: 'Cheesecake' })
      apiFetchMock.mockResolvedValueOnce(created)
      const wrapper = mountModal()

      await wrapper.find('#item-text').setValue('  Cheesecake  ')
      await wrapper.find('#item-note').setValue('   ')
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(apiFetchMock).toHaveBeenCalledWith('/lists/list-1/items', {
        method: 'POST',
        body: JSON.stringify({ text: 'Cheesecake', note: null, image_url: null }),
      })
      expect(wrapper.emitted('saved')).toEqual([[created]])
    })

    it('sends note and image_url when provided', async () => {
      apiFetchMock.mockResolvedValueOnce(makeItem())
      const wrapper = mountModal()

      await wrapper.find('#item-text').setValue('Cheesecake')
      await wrapper.find('#item-note').setValue('the good kind')
      await wrapper.find('#item-image-url').setValue('https://example.com/pic.jpg')
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(apiFetchMock).toHaveBeenCalledWith('/lists/list-1/items', {
        method: 'POST',
        body: JSON.stringify({
          text: 'Cheesecake',
          note: 'the good kind',
          image_url: 'https://example.com/pic.jpg',
        }),
      })
    })

    it('blocks submit client-side when the text is empty', async () => {
      const wrapper = mountModal()

      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(apiFetchMock).not.toHaveBeenCalled()
      expect(wrapper.find('[role="alert"]').text()).toContain('Text is required')
    })

    it('blocks submit client-side on a non-http(s) image URL', async () => {
      const wrapper = mountModal()

      await wrapper.find('#item-text').setValue('Cheesecake')
      await wrapper.find('#item-image-url').setValue('javascript:alert(1)')
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(apiFetchMock).not.toHaveBeenCalled()
      expect(wrapper.find('[role="alert"]').text()).toContain('http:// or https://')
    })

    it("shows the backend's 409 copy inline and stays open", async () => {
      apiFetchMock.mockRejectedValueOnce(
        new ApiError(409, 'conflict', 'An item with this text already exists in this list.'),
      )
      const wrapper = mountModal()

      await wrapper.find('#item-text').setValue('Cheesecake')
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(wrapper.emitted('saved')).toBeUndefined()
      expect(wrapper.find('[role="alert"]').text()).toBe(
        'An item with this text already exists in this list.',
      )
    })
  })

  describe('edit mode', () => {
    const ITEM = makeItem({
      id: 'item-9',
      text: 'Cheesecake',
      note: 'the good kind',
      image_url: 'https://example.com/pic.jpg',
    })

    it('prefills the form from the item', () => {
      const wrapper = mountModal(ITEM)

      expect(wrapper.text()).toContain('Edit item')
      expect((wrapper.find('#item-text').element as HTMLInputElement).value).toBe('Cheesecake')
      expect((wrapper.find('#item-note').element as HTMLTextAreaElement).value).toBe(
        'the good kind',
      )
      expect((wrapper.find('#item-image-url').element as HTMLInputElement).value).toBe(
        'https://example.com/pic.jpg',
      )
    })

    it('PATCHes the item and emits saved with the response', async () => {
      const updated = { ...ITEM, text: 'Basque cheesecake' }
      apiFetchMock.mockResolvedValueOnce(updated)
      const wrapper = mountModal(ITEM)

      await wrapper.find('#item-text').setValue('Basque cheesecake')
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(apiFetchMock).toHaveBeenCalledWith('/lists/list-1/items/item-9', {
        method: 'PATCH',
        body: JSON.stringify({
          text: 'Basque cheesecake',
          note: 'the good kind',
          image_url: 'https://example.com/pic.jpg',
        }),
      })
      expect(wrapper.emitted('saved')).toEqual([[updated]])
    })
  })

  it('Cancel emits cancel without calling the API', async () => {
    const wrapper = mountModal()

    const cancelButton = wrapper.findAll('button').find((b) => b.text() === 'Cancel')
    await cancelButton!.trigger('click')

    expect(apiFetchMock).not.toHaveBeenCalled()
    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })
})
