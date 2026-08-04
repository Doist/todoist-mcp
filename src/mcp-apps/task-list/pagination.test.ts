import { describe, expect, it, vi } from 'vitest'

import { loadRemainingPages } from './pagination.js'

describe('loadRemainingPages', () => {
    it('fetches every following cursor in order', async () => {
        const fetchPage = vi
            .fn()
            .mockResolvedValueOnce({ tasks: ['second'], nextCursor: 'third-page' })
            .mockResolvedValueOnce({ tasks: ['third'] })
        const onPage = vi.fn()

        await loadRemainingPages({
            initialCursor: 'second-page',
            fetchPage,
            onPage,
        })

        expect(fetchPage).toHaveBeenNthCalledWith(1, 'second-page')
        expect(fetchPage).toHaveBeenNthCalledWith(2, 'third-page')
        expect(onPage).toHaveBeenCalledWith({ tasks: ['second'], nextCursor: 'third-page' })
        expect(onPage).toHaveBeenCalledWith({ tasks: ['third'] })
    })

    it('does not request another page when the initial result has no cursor', async () => {
        const fetchPage = vi.fn()

        await loadRemainingPages({
            initialCursor: undefined,
            fetchPage,
            onPage: vi.fn(),
        })

        expect(fetchPage).not.toHaveBeenCalled()
    })

    it('stops when the page handler cancels pagination', async () => {
        const fetchPage = vi.fn().mockResolvedValue({ nextCursor: 'third-page' })

        await loadRemainingPages({
            initialCursor: 'second-page',
            fetchPage,
            onPage: () => false,
        })

        expect(fetchPage).toHaveBeenCalledTimes(1)
    })

    it('stops a malformed pagination loop', async () => {
        const fetchPage = vi.fn().mockResolvedValue({ nextCursor: 'same-cursor' })

        await expect(
            loadRemainingPages({
                initialCursor: 'same-cursor',
                fetchPage,
                onPage: vi.fn(),
            }),
        ).rejects.toThrow('repeated cursor')

        expect(fetchPage).toHaveBeenCalledTimes(1)
    })
})
