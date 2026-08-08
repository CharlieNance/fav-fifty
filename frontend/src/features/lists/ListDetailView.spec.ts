import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { flushPromises, mount } from '@vue/test-utils'
import { VueDraggable } from 'vue-draggable-plus'

import { ApiError } from '@/api/client'
import type { ListItem, ListSummary } from './types'

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>()
  return { ...actual, apiFetch: vi.fn() }
})

import { apiFetch } from '@/api/client'
import { makeItems } from './itemTestUtils'
import ListDetailView from './ListDetailView.vue'

const apiFetchMock = vi.mocked(apiFetch)

const stub = { template: '<div />' }

function testRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/lists', name: 'lists', component: stub },
      { path: '/lists/:id', name: 'list-detail', component: ListDetailView },
    ],
  })
}

const LIST: ListSummary = {
  id: 'list-1',
  title: 'Best sandwiches',
  status: 'draft',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

/**
 * Route-keyed API mock: keys are `"METHOD /path"`, values resolve (or, for an
 * Error value, reject) that request. Persistent (not `...Once`), so re-fetches
 * hit the same table; tests override entries between interactions as needed.
 */
function mockApi(routes: Record<string, unknown>): void {
  apiFetchMock.mockImplementation((path: string, options?: RequestInit) => {
    const key = `${options?.method ?? 'GET'} ${path}`
    if (key in routes) {
      const value = routes[key]
      return value instanceof Error ? Promise.reject(value) : Promise.resolve(value)
    }
    return Promise.reject(new Error(`unmocked request: ${key}`))
  })
}

function initialRoutes(items: ListItem[] = []): Record<string, unknown> {
  return { 'GET /lists/list-1': LIST, 'GET /lists/list-1/items': items }
}

async function mountAtDetail(router: Router, id = 'list-1') {
  router.push(`/lists/${id}`)
  await router.isReady()
  return mount({ template: '<router-view />' }, { global: { plugins: [router] } })
}

describe('ListDetailView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    apiFetchMock.mockReset()
  })

  it('shows a loading state while the list request is in flight', async () => {
    let resolveList: (value: ListSummary) => void = () => {}
    apiFetchMock.mockImplementation((path: string) => {
      if (path === '/lists/list-1') {
        return new Promise((resolve) => {
          resolveList = resolve
        })
      }
      return Promise.resolve([])
    })

    const wrapper = await mountAtDetail(testRouter())

    expect(wrapper.text()).toContain('Loading')
    resolveList(LIST)
    await flushPromises()
  })

  it('renders a not-found state on 404 without ever requesting items', async () => {
    mockApi({ 'GET /lists/list-1': new ApiError(404, 'Not found') })

    const wrapper = await mountAtDetail(testRouter())
    await flushPromises()

    expect(wrapper.text()).toContain("doesn't exist")
    expect(apiFetchMock).toHaveBeenCalledTimes(1)
  })

  it('renders an error state on other failures', async () => {
    mockApi({ 'GET /lists/list-1': new ApiError(500, 'boom') })

    const wrapper = await mountAtDetail(testRouter())
    await flushPromises()

    expect(wrapper.text()).toContain('Something went wrong loading this list')
  })

  it('renders an items-specific error when the list loads but the items fetch fails', async () => {
    mockApi({ 'GET /lists/list-1': LIST, 'GET /lists/list-1/items': new ApiError(500, 'boom') })

    const wrapper = await mountAtDetail(testRouter())
    await flushPromises()

    expect(wrapper.text()).toContain('Best sandwiches')
    expect(wrapper.text()).toContain('Something went wrong loading the items')
  })

  describe('empty list', () => {
    it('renders the invitation empty state with an add button', async () => {
      mockApi(initialRoutes([]))

      const wrapper = await mountAtDetail(testRouter())
      await flushPromises()

      expect(wrapper.text()).toContain('Nothing ranked yet')
      expect(wrapper.text()).toContain('Add your first favorite')
    })

    it('adds the first item through the modal and renders the new row', async () => {
      const routes = initialRoutes([])
      mockApi(routes)
      const wrapper = await mountAtDetail(testRouter())
      await flushPromises()

      const addButton = wrapper
        .findAll('button')
        .find((b) => b.text() === 'Add your first favorite')
      await addButton!.trigger('click')

      const created = makeItems(1)[0]
      routes['POST /lists/list-1/items'] = created
      await wrapper.find('#item-text').setValue('Favorite thing 1')
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(apiFetchMock).toHaveBeenCalledWith('/lists/list-1/items', {
        method: 'POST',
        body: JSON.stringify({ text: 'Favorite thing 1', note: null, image_url: null }),
      })
      expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
      expect(wrapper.text()).toContain('Favorite thing 1')
      expect(wrapper.text()).toContain('1')
    })
  })

  describe('populated list', () => {
    it('renders the rows in rank order with the count', async () => {
      mockApi(initialRoutes(makeItems(3)))

      const wrapper = await mountAtDetail(testRouter())
      await flushPromises()

      const rows = wrapper.findAll('li')
      expect(rows).toHaveLength(3)
      expect(rows[0].text()).toContain('Favorite thing 1')
      expect(rows[2].text()).toContain('Favorite thing 3')
      expect(wrapper.text()).toContain('3')
      expect(wrapper.text()).toContain(`of 50 ranked`)
    })

    it('disables Add item when the list is at 50', async () => {
      mockApi(initialRoutes(makeItems(50)))

      const wrapper = await mountAtDetail(testRouter())
      await flushPromises()

      const addButton = wrapper.findAll('button').find((b) => b.text() === 'Add item')
      expect(addButton!.attributes('disabled')).toBeDefined()
      expect(wrapper.text()).toContain('a full fifty')
    })

    it('edits an item through the prefilled modal and re-renders the row', async () => {
      const items = makeItems(2)
      const routes = initialRoutes(items)
      mockApi(routes)
      const wrapper = await mountAtDetail(testRouter())
      await flushPromises()

      const editButton = wrapper
        .findAll('button')
        .find((b) => b.attributes('aria-label') === 'Edit Favorite thing 2')
      await editButton!.trigger('click')

      expect((wrapper.find('#item-text').element as HTMLInputElement).value).toBe(
        'Favorite thing 2',
      )

      routes['PATCH /lists/list-1/items/item-2'] = { ...items[1], text: 'Even better thing' }
      await wrapper.find('#item-text').setValue('Even better thing')
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(wrapper.text()).toContain('Even better thing')
      expect(wrapper.text()).not.toContain('Favorite thing 2')
    })

    it('deletes an item after confirming, renumbering the rows left behind', async () => {
      const routes = initialRoutes(makeItems(3))
      mockApi(routes)
      const wrapper = await mountAtDetail(testRouter())
      await flushPromises()

      const deleteButton = wrapper
        .findAll('button')
        .find((b) => b.attributes('aria-label') === 'Delete Favorite thing 1')
      await deleteButton!.trigger('click')

      expect(wrapper.text()).toContain("Delete 'Favorite thing 1'?")

      routes['DELETE /lists/list-1/items/item-1'] = undefined
      const dialog = wrapper.get('[role="dialog"]')
      const confirmButton = dialog.findAll('button').find((b) => b.text() === 'Delete')
      await confirmButton!.trigger('click')
      await flushPromises()

      expect(apiFetchMock).toHaveBeenCalledWith('/lists/list-1/items/item-1', {
        method: 'DELETE',
      })
      const rows = wrapper.findAll('li')
      expect(rows).toHaveLength(2)
      // The old #2 is the new #1 — positions repack locally like the backend does.
      expect(rows[0].text()).toContain('Favorite thing 2')
      expect(rows[0].text()).toContain('1')
    })

    it('cancelling the delete keeps the item and calls no API', async () => {
      mockApi(initialRoutes(makeItems(2)))
      const wrapper = await mountAtDetail(testRouter())
      await flushPromises()
      const callsAfterLoad = apiFetchMock.mock.calls.length

      const deleteButton = wrapper
        .findAll('button')
        .find((b) => b.attributes('aria-label') === 'Delete Favorite thing 1')
      await deleteButton!.trigger('click')
      const cancelButton = wrapper.findAll('button').find((b) => b.text() === 'Cancel')
      await cancelButton!.trigger('click')

      expect(apiFetchMock).toHaveBeenCalledTimes(callsAfterLoad)
      expect(wrapper.findAll('li')).toHaveLength(2)
    })
  })

  describe('reorder', () => {
    it('the down button PATCHes the position and re-renders in the server order', async () => {
      const [first, second] = makeItems(2)
      const routes = initialRoutes([first, second])
      routes['PATCH /lists/list-1/items/item-1/position'] = [
        { ...second, position: 1 },
        { ...first, position: 2 },
      ]
      mockApi(routes)
      const wrapper = await mountAtDetail(testRouter())
      await flushPromises()

      const downButton = wrapper
        .findAll('button')
        .find((b) => b.attributes('aria-label') === 'Move Favorite thing 1 down')
      await downButton!.trigger('click')
      await flushPromises()

      expect(apiFetchMock).toHaveBeenCalledWith('/lists/list-1/items/item-1/position', {
        method: 'PATCH',
        body: JSON.stringify({ position: 2 }),
      })
      const rows = wrapper.findAll('li')
      expect(rows[0].text()).toContain('Favorite thing 2')
      expect(rows[1].text()).toContain('Favorite thing 1')
    })

    it('a drag drop calls the same endpoint with the new 1-based rank', async () => {
      const [first, second, third] = makeItems(3)
      const routes = initialRoutes([first, second, third])
      routes['PATCH /lists/list-1/items/item-3/position'] = [
        { ...third, position: 1 },
        { ...first, position: 2 },
        { ...second, position: 3 },
      ]
      mockApi(routes)
      const wrapper = await mountAtDetail(testRouter())
      await flushPromises()

      // Simulate what VueDraggable does on drop: it reorders the bound array…
      const drag = wrapper.findComponent(VueDraggable)
      drag.vm.$emit('update:modelValue', [third, first, second])
      // …then fires SortableJS's `update` with the moved row's element.
      drag.vm.$emit('update', { item: { dataset: { id: 'item-3' } }, oldIndex: 2, newIndex: 0 })
      await flushPromises()

      expect(apiFetchMock).toHaveBeenCalledWith('/lists/list-1/items/item-3/position', {
        method: 'PATCH',
        body: JSON.stringify({ position: 1 }),
      })
      const rows = wrapper.findAll('li')
      expect(rows[0].text()).toContain('Favorite thing 3')
    })

    it('a failed drag reorder rolls the rows back to the server order and shows an alert', async () => {
      const [first, second, third] = makeItems(3)
      const routes = initialRoutes([first, second, third])
      routes['PATCH /lists/list-1/items/item-3/position'] = new ApiError(500, 'boom')
      mockApi(routes)
      const wrapper = await mountAtDetail(testRouter())
      await flushPromises()

      const drag = wrapper.findComponent(VueDraggable)
      drag.vm.$emit('update:modelValue', [third, first, second])
      drag.vm.$emit('update', { item: { dataset: { id: 'item-3' } }, oldIndex: 2, newIndex: 0 })
      await flushPromises()

      // Order resnaps to what the server still has…
      const rows = wrapper.findAll('li')
      expect(rows[0].text()).toContain('Favorite thing 1')
      expect(rows[2].text()).toContain('Favorite thing 3')
      // …and the user is told why everything just snapped back.
      expect(wrapper.find('[role="alert"]').text()).toContain('Could not move the item')
    })
  })

  describe('list-level actions (unchanged by the items feature)', () => {
    it('Edit opens EditListModal and saving updates the title without navigating', async () => {
      const routes = initialRoutes([])
      mockApi(routes)
      const router = testRouter()
      const wrapper = await mountAtDetail(router)
      await flushPromises()

      const editButton = wrapper.findAll('button').find((b) => b.text() === 'Edit')
      await editButton!.trigger('click')
      expect(wrapper.find('[role="dialog"]').exists()).toBe(true)

      routes['PATCH /lists/list-1'] = { ...LIST, title: 'Favorite sandwiches' }
      await wrapper.find('#edit-list-title').setValue('Favorite sandwiches')
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(wrapper.text()).toContain('Favorite sandwiches')
      expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
      expect(router.currentRoute.value.name).toBe('list-detail')
    })

    it('confirming list delete calls DELETE and redirects to /lists', async () => {
      const routes = initialRoutes([])
      mockApi(routes)
      const router = testRouter()
      const wrapper = await mountAtDetail(router)
      await flushPromises()

      const deleteButton = wrapper.findAll('button').find((b) => b.text() === 'Delete')
      await deleteButton!.trigger('click')

      routes['DELETE /lists/list-1'] = undefined
      const dialog = wrapper.get('[role="dialog"]')
      const confirmButton = dialog.findAll('button').find((b) => b.text() === 'Delete')
      await confirmButton!.trigger('click')
      await flushPromises()

      expect(apiFetchMock).toHaveBeenCalledWith('/lists/list-1', { method: 'DELETE' })
      expect(router.currentRoute.value.name).toBe('lists')
    })
  })
})
