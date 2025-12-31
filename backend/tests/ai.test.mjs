/**
 * Tests for AI Gateway Module
 * @module tests/ai.test
 */

import { jest } from '@jest/globals';

// Mock axios before importing the module
jest.unstable_mockModule('axios', () => ({
    default: {
        post: jest.fn(),
    },
}));

// Mock logger
jest.unstable_mockModule('../lib/logging/logger.js', () => ({
    createLogger: () => ({
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    }),
}));

describe('AI Gateway Module', () => {
    let aiModule;
    let axios;

    beforeAll(async () => {
        axios = (await import('axios')).default;
        aiModule = await import('../lib/ai/index.mjs');
    });

    beforeEach(() => {
        jest.clearAllMocks();
        // Reset singleton
        aiModule._resetGateway();
    });

    describe('IAIGateway interface', () => {
        describe('isAIGateway', () => {
            it('should return true for valid gateway', () => {
                const validGateway = {
                    chat: () => {},
                    chatWithImage: () => {},
                    chatWithJson: () => {},
                    transcribe: () => {},
                    embed: () => {},
                };
                expect(aiModule.isAIGateway(validGateway)).toBe(true);
            });

            it('should return false for null', () => {
                expect(aiModule.isAIGateway(null)).toBe(false);
            });

            it('should return false for missing methods', () => {
                const invalidGateway = {
                    chat: () => {},
                    // missing other methods
                };
                expect(aiModule.isAIGateway(invalidGateway)).toBe(false);
            });

            it('should return false for non-function properties', () => {
                const invalidGateway = {
                    chat: 'not a function',
                    chatWithImage: () => {},
                    chatWithJson: () => {},
                    transcribe: () => {},
                    embed: () => {},
                };
                expect(aiModule.isAIGateway(invalidGateway)).toBe(false);
            });
        });

        describe('assertAIGateway', () => {
            it('should return gateway if valid', () => {
                const validGateway = {
                    chat: () => {},
                    chatWithImage: () => {},
                    chatWithJson: () => {},
                    transcribe: () => {},
                    embed: () => {},
                };
                expect(aiModule.assertAIGateway(validGateway)).toBe(validGateway);
            });

            it('should throw for invalid gateway', () => {
                expect(() => aiModule.assertAIGateway({})).toThrow('does not implement IAIGateway');
            });
        });
    });

    describe('Message helpers', () => {
        it('systemMessage should create system role message', () => {
            const msg = aiModule.systemMessage('You are helpful');
            expect(msg).toEqual({ role: 'system', content: 'You are helpful' });
        });

        it('userMessage should create user role message', () => {
            const msg = aiModule.userMessage('Hello');
            expect(msg).toEqual({ role: 'user', content: 'Hello' });
        });

        it('assistantMessage should create assistant role message', () => {
            const msg = aiModule.assistantMessage('Hi there!');
            expect(msg).toEqual({ role: 'assistant', content: 'Hi there!' });
        });
    });

    describe('Error classes', () => {
        describe('AIError', () => {
            it('should create base error with context', () => {
                const error = new aiModule.AIError('Test error', { foo: 'bar' });
                expect(error.message).toBe('Test error');
                expect(error.context).toEqual({ foo: 'bar' });
                expect(error.name).toBe('AIError');
                expect(error.timestamp).toBeDefined();
            });
        });

        describe('AIServiceError', () => {
            it('should include service name', () => {
                const error = new aiModule.AIServiceError('OpenAI', 'API failed');
                expect(error.message).toBe('OpenAI: API failed');
                expect(error.service).toBe('OpenAI');
                expect(error.httpStatus).toBe(502);
                expect(error.retryable).toBe(true);
            });
        });

        describe('AIRateLimitError', () => {
            it('should include retry after', () => {
                const error = new aiModule.AIRateLimitError('OpenAI', 60);
                expect(error.message).toContain('Rate limit exceeded');
                expect(error.retryAfter).toBe(60);
                expect(error.httpStatus).toBe(429);
            });
        });

        describe('AITimeoutError', () => {
            it('should include timeout info', () => {
                const error = new aiModule.AITimeoutError('chat', 30000);
                expect(error.message).toContain('timed out after 30000ms');
                expect(error.operation).toBe('chat');
                expect(error.timeoutMs).toBe(30000);
                expect(error.httpStatus).toBe(504);
            });
        });

        describe('Type guards', () => {
            it('isAIError should detect AI errors', () => {
                expect(aiModule.isAIError(new aiModule.AIError('test'))).toBe(true);
                expect(aiModule.isAIError(new Error('test'))).toBe(false);
            });

            it('isRetryableAIError should check retryable flag', () => {
                expect(aiModule.isRetryableAIError(new aiModule.AIServiceError('OpenAI', 'fail'))).toBe(true);
                expect(aiModule.isRetryableAIError(new aiModule.AIError('fail'))).toBe(false);
            });
        });
    });

    describe('getAIGateway', () => {
        const originalEnv = process.env;

        beforeEach(() => {
            process.env = { ...originalEnv };
            aiModule._resetGateway();
        });

        afterAll(() => {
            process.env = originalEnv;
        });

        it('should throw if OPENAI_API_KEY not set', () => {
            delete process.env.OPENAI_API_KEY;
            expect(() => aiModule.getAIGateway()).toThrow('OPENAI_API_KEY not configured');
        });

        it('should return singleton instance', () => {
            process.env.OPENAI_API_KEY = 'test-key';
            const gateway1 = aiModule.getAIGateway();
            const gateway2 = aiModule.getAIGateway();
            expect(gateway1).toBe(gateway2);
        });

        it('should create gateway with API key from env', () => {
            process.env.OPENAI_API_KEY = 'test-key';
            const gateway = aiModule.getAIGateway();
            expect(gateway).toBeDefined();
            expect(aiModule.isAIGateway(gateway)).toBe(true);
        });
    });

    describe('createAIGateway', () => {
        it('should create new instance with config', () => {
            const gateway = aiModule.createAIGateway({
                apiKey: 'custom-key',
                model: 'gpt-3.5-turbo',
                maxTokens: 500,
            });
            expect(gateway).toBeDefined();
            expect(gateway.model).toBe('gpt-3.5-turbo');
        });

        it('should throw without apiKey', () => {
            expect(() => aiModule.createAIGateway({})).toThrow('API key is required');
        });
    });

    describe('OpenAIGateway', () => {
        let gateway;

        beforeEach(() => {
            gateway = aiModule.createAIGateway({
                apiKey: 'test-key',
                model: 'gpt-4o',
                maxTokens: 1000,
            });
        });

        describe('chat', () => {
            it('should call OpenAI API and return response', async () => {
                axios.post.mockResolvedValueOnce({
                    data: {
                        choices: [{ message: { content: 'Hello!' } }],
                        usage: { prompt_tokens: 10, completion_tokens: 5 },
                    },
                });

                const messages = [
                    aiModule.systemMessage('Be helpful'),
                    aiModule.userMessage('Hi'),
                ];
                const response = await gateway.chat(messages);

                expect(response).toBe('Hello!');
                expect(axios.post).toHaveBeenCalledWith(
                    'https://api.openai.com/v1/chat/completions',
                    expect.objectContaining({
                        model: 'gpt-4o',
                        messages,
                    }),
                    expect.any(Object)
                );
            });

            it('should use custom model and temperature', async () => {
                axios.post.mockResolvedValueOnce({
                    data: {
                        choices: [{ message: { content: 'Response' } }],
                    },
                });

                await gateway.chat([], { model: 'gpt-3.5-turbo', temperature: 0.5 });

                expect(axios.post).toHaveBeenCalledWith(
                    expect.any(String),
                    expect.objectContaining({
                        model: 'gpt-3.5-turbo',
                        temperature: 0.5,
                    }),
                    expect.any(Object)
                );
            });
        });

        describe('chatWithJson', () => {
            it('should parse JSON response', async () => {
                axios.post.mockResolvedValueOnce({
                    data: {
                        choices: [{ message: { content: '{"foo": "bar"}' } }],
                    },
                });

                const result = await gateway.chatWithJson([
                    aiModule.userMessage('Return JSON'),
                ]);

                expect(result).toEqual({ foo: 'bar' });
            });

            it('should set response_format for JSON mode', async () => {
                axios.post.mockResolvedValueOnce({
                    data: {
                        choices: [{ message: { content: '{}' } }],
                    },
                });

                await gateway.chatWithJson([]);

                expect(axios.post).toHaveBeenCalledWith(
                    expect.any(String),
                    expect.objectContaining({
                        response_format: { type: 'json_object' },
                    }),
                    expect.any(Object)
                );
            });

            it('should retry on JSON parse failure', async () => {
                // First call returns invalid JSON
                axios.post.mockResolvedValueOnce({
                    data: {
                        choices: [{ message: { content: 'Not valid JSON' } }],
                    },
                });
                // Retry returns valid JSON
                axios.post.mockResolvedValueOnce({
                    data: {
                        choices: [{ message: { content: '{"valid": true}' } }],
                    },
                });

                const result = await gateway.chatWithJson([
                    aiModule.userMessage('Return JSON'),
                ]);

                expect(result).toEqual({ valid: true });
                expect(axios.post).toHaveBeenCalledTimes(2);
            });
        });

        describe('Error handling', () => {
            it('should throw AIRateLimitError on 429', async () => {
                axios.post.mockRejectedValueOnce({
                    response: {
                        status: 429,
                        headers: { 'retry-after': '30' },
                    },
                });

                await expect(gateway.chat([])).rejects.toThrow(aiModule.AIRateLimitError);
            });

            it('should throw AITimeoutError on timeout', async () => {
                axios.post.mockRejectedValueOnce({
                    code: 'ECONNABORTED',
                    message: 'timeout of 60000ms exceeded',
                });

                await expect(gateway.chat([])).rejects.toThrow(aiModule.AITimeoutError);
            });

            it('should throw AIServiceError on other errors', async () => {
                axios.post.mockRejectedValueOnce({
                    response: {
                        status: 500,
                        data: { error: { message: 'Server error' } },
                    },
                });

                await expect(gateway.chat([])).rejects.toThrow(aiModule.AIServiceError);
            });
        });

        describe('embed', () => {
            it('should return embedding vector', async () => {
                const embedding = [0.1, 0.2, 0.3];
                axios.post.mockResolvedValueOnce({
                    data: {
                        data: [{ embedding }],
                    },
                });

                const result = await gateway.embed('test text');

                expect(result).toEqual(embedding);
                expect(axios.post).toHaveBeenCalledWith(
                    'https://api.openai.com/v1/embeddings',
                    expect.objectContaining({
                        model: 'text-embedding-3-small',
                        input: 'test text',
                    }),
                    expect.any(Object)
                );
            });
        });
    });
});
