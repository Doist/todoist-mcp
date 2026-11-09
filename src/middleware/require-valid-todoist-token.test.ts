import type { Request, Response } from 'express'
import { type Mock, afterEach, beforeEach, vi } from 'vitest'

import {
    clearTokenValidationCache,
    requireValidTodoistToken,
} from './require-valid-todoist-token.js'

vi.mock('../utils/validate-todoist-token.js', () => ({
    validateTodoistToken: vi.fn(),
}))

import { validateTodoistToken } from '../utils/validate-todoist-token.js'

const mockValidate = validateTodoistToken as Mock

function createMockRes(): Response {
    const res = {
        status: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
    }
    return res as unknown as Response
}

describe('requireValidTodoistToken', () => {
    let next: Mock

    beforeEach(() => {
        next = vi.fn()
        clearTokenValidationCache()
        mockValidate.mockReset()
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    describe('static mode', () => {
        it('should call next() for a valid token', async () => {
            mockValidate.mockResolvedValue('valid')
            const middleware = requireValidTodoistToken({
                type: 'static',
                apiKey: 'valid-key',
            })

            await middleware({} as Request, createMockRes(), next)

            expect(next).toHaveBeenCalledOnce()
            expect(mockValidate).toHaveBeenCalledWith('valid-key', undefined)
        })

        it('should return 401 for an invalid token', async () => {
            mockValidate.mockResolvedValue('invalid')
            const middleware = requireValidTodoistToken({
                type: 'static',
                apiKey: 'bad-key',
            })
            const res = createMockRes()

            await middleware({} as Request, res, next)

            expect(next).not.toHaveBeenCalled()
            expect(res.status).toHaveBeenCalledWith(401)
            expect(res.set).toHaveBeenCalledWith('WWW-Authenticate', 'Bearer')
            expect(res.json).toHaveBeenCalledWith({
                error: 'invalid_token',
                error_description: 'Todoist API token is invalid or expired',
            })
        })

        it('should include resource_metadata in WWW-Authenticate when configured', async () => {
            mockValidate.mockResolvedValue('invalid')
            const middleware = requireValidTodoistToken({
                type: 'static',
                apiKey: 'bad-key',
                resourceMetadataUrl: 'https://example.com/.well-known/oauth-protected-resource',
            })
            const res = createMockRes()

            await middleware({} as Request, res, next)

            expect(res.set).toHaveBeenCalledWith(
                'WWW-Authenticate',
                'Bearer resource_metadata="https://example.com/.well-known/oauth-protected-resource"',
            )
        })

        it('returns 403 with an insufficient_scope challenge for a forbidden token', async () => {
            mockValidate.mockResolvedValue('forbidden')
            const middleware = requireValidTodoistToken({
                type: 'static',
                apiKey: 'narrow-key',
            })
            const res = createMockRes()

            await middleware({} as Request, res, next)

            expect(next).not.toHaveBeenCalled()
            expect(res.status).toHaveBeenCalledWith(403)
            expect(res.set).toHaveBeenCalledWith(
                'WWW-Authenticate',
                'Bearer error="insufficient_scope"',
            )
            expect(res.json).toHaveBeenCalledWith({
                error: 'insufficient_scope',
                error_description: 'Todoist API token does not have the required scopes',
            })
        })

        it('includes resource_metadata in the insufficient_scope challenge when configured', async () => {
            mockValidate.mockResolvedValue('forbidden')
            const middleware = requireValidTodoistToken({
                type: 'static',
                apiKey: 'narrow-key',
                resourceMetadataUrl: 'https://example.com/.well-known/oauth-protected-resource',
            })
            const res = createMockRes()

            await middleware({} as Request, res, next)

            expect(res.set).toHaveBeenCalledWith(
                'WWW-Authenticate',
                'Bearer error="insufficient_scope", resource_metadata="https://example.com/.well-known/oauth-protected-resource"',
            )
        })

        it('should pass baseUrl to validateTodoistToken', async () => {
            mockValidate.mockResolvedValue('valid')
            const middleware = requireValidTodoistToken({
                type: 'static',
                apiKey: 'key',
                baseUrl: 'https://custom.api.com',
            })

            await middleware({} as Request, createMockRes(), next)

            expect(mockValidate).toHaveBeenCalledWith('key', 'https://custom.api.com')
        })
    })

    describe('dynamic mode', () => {
        it('should extract key from request and call next() for valid token', async () => {
            mockValidate.mockResolvedValue('valid')
            const middleware = requireValidTodoistToken({
                type: 'dynamic',
                getApiKey: (req) => (req.headers as Record<string, string>)['x-todoist-token'],
            })
            const req = { headers: { 'x-todoist-token': 'dynamic-key' } } as unknown as Request

            await middleware(req, createMockRes(), next)

            expect(next).toHaveBeenCalledOnce()
            expect(mockValidate).toHaveBeenCalledWith('dynamic-key', undefined)
        })

        it('should return 401 when getApiKey returns undefined', async () => {
            const middleware = requireValidTodoistToken({
                type: 'dynamic',
                getApiKey: () => undefined,
            })
            const res = createMockRes()

            await middleware({} as Request, res, next)

            expect(next).not.toHaveBeenCalled()
            expect(res.status).toHaveBeenCalledWith(401)
            expect(mockValidate).not.toHaveBeenCalled()
        })
    })

    describe('caching', () => {
        it('should cache valid results and skip subsequent API calls', async () => {
            mockValidate.mockResolvedValue('valid')
            const middleware = requireValidTodoistToken({
                type: 'static',
                apiKey: 'cached-key',
            })
            const res1 = createMockRes()
            const res2 = createMockRes()

            await middleware({} as Request, res1, next)
            await middleware({} as Request, res2, next)

            expect(mockValidate).toHaveBeenCalledOnce()
            expect(next).toHaveBeenCalledTimes(2)
        })

        it('should cache invalid results and skip subsequent API calls', async () => {
            mockValidate.mockResolvedValue('invalid')
            const middleware = requireValidTodoistToken({
                type: 'static',
                apiKey: 'bad-cached-key',
            })
            const res1 = createMockRes()
            const res2 = createMockRes()
            const next2 = vi.fn()

            await middleware({} as Request, res1, next)
            await middleware({} as Request, res2, next2)

            expect(mockValidate).toHaveBeenCalledOnce()
            expect(next).not.toHaveBeenCalled()
            expect(next2).not.toHaveBeenCalled()
            expect(res1.status).toHaveBeenCalledWith(401)
            expect(res2.status).toHaveBeenCalledWith(401)
        })

        it('caches a forbidden verdict as forbidden', async () => {
            mockValidate.mockResolvedValue('forbidden')
            const middleware = requireValidTodoistToken({
                type: 'static',
                apiKey: 'narrow-cached-key',
            })
            const res1 = createMockRes()
            const res2 = createMockRes()

            await middleware({} as Request, res1, next)
            await middleware({} as Request, res2, next)

            expect(mockValidate).toHaveBeenCalledOnce()
            expect(next).not.toHaveBeenCalled()
            expect(res1.status).toHaveBeenCalledWith(403)
            expect(res2.status).toHaveBeenCalledWith(403)
        })

        it('should re-validate after cache expires', async () => {
            vi.useFakeTimers()
            mockValidate.mockResolvedValue('valid')
            const middleware = requireValidTodoistToken({
                type: 'static',
                apiKey: 'expiring-key',
                cacheTtlMs: 1000,
            })

            await middleware({} as Request, createMockRes(), next)
            expect(mockValidate).toHaveBeenCalledOnce()

            vi.advanceTimersByTime(1001)

            await middleware({} as Request, createMockRes(), next)
            expect(mockValidate).toHaveBeenCalledTimes(2)

            vi.useRealTimers()
        })

        it('should use separate cache entries for different baseUrls', async () => {
            mockValidate.mockResolvedValue('valid')
            const middleware1 = requireValidTodoistToken({
                type: 'static',
                apiKey: 'same-key',
                baseUrl: 'https://api.todoist.com',
            })
            const middleware2 = requireValidTodoistToken({
                type: 'static',
                apiKey: 'same-key',
                baseUrl: 'https://staging.todoist.com',
            })

            await middleware1({} as Request, createMockRes(), next)
            await middleware2({} as Request, createMockRes(), next)

            expect(mockValidate).toHaveBeenCalledTimes(2)
            expect(mockValidate).toHaveBeenCalledWith('same-key', 'https://api.todoist.com')
            expect(mockValidate).toHaveBeenCalledWith('same-key', 'https://staging.todoist.com')
        })
    })

    describe('transient errors', () => {
        it('should fail open on transient errors and call next()', async () => {
            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
            mockValidate.mockRejectedValue(new Error('Network error'))
            const middleware = requireValidTodoistToken({
                type: 'static',
                apiKey: 'key',
            })

            await middleware({} as Request, createMockRes(), next)

            expect(next).toHaveBeenCalledOnce()
            expect(consoleSpy).toHaveBeenCalledWith(
                '[Token validation] Transient error, proceeding:',
                expect.any(Error),
            )
        })
    })
})
