/**
 * Tests for Shopping Harvester
 * @module tests/shopping.test
 */

import { jest } from '@jest/globals';

// Mock dependencies
jest.unstable_mockModule('googleapis', () => ({
    google: {
        auth: {
            OAuth2: jest.fn().mockImplementation(() => ({
                setCredentials: jest.fn()
            }))
        },
        gmail: jest.fn().mockReturnValue({
            users: {
                messages: {
                    list: jest.fn(),
                    get: jest.fn()
                }
            }
        })
    }
}));

jest.unstable_mockModule('../lib/io.mjs', () => ({
    userSaveFile: jest.fn(() => true),
    userLoadFile: jest.fn(() => null),
    userLoadAuth: jest.fn(() => ({ refresh_token: 'mock-token' })),
    getDefaultUsername: jest.fn(() => 'testuser'),
    householdLoadFile: jest.fn(() => null)
}));

jest.unstable_mockModule('../lib/config/ConfigService.mjs', () => ({
    configService: {
        getUserHouseholdId: jest.fn(() => 'default'),
        getDefaultHouseholdId: jest.fn(() => 'default')
    }
}));

jest.unstable_mockModule('../lib/logging/logger.js', () => ({
    createLogger: () => ({
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
    })
}));

jest.unstable_mockModule('../lib/ai/index.mjs', () => ({
    getAIGateway: jest.fn(() => ({
        chatWithJson: jest.fn()
    })),
    systemMessage: (content) => ({ role: 'system', content }),
    userMessage: (content) => ({ role: 'user', content })
}));

describe('Shopping Harvester', () => {
    let shopping;
    let aiModule;
    let ioModule;

    beforeAll(async () => {
        shopping = await import('../lib/shopping.mjs');
        aiModule = await import('../lib/ai/index.mjs');
        ioModule = await import('../lib/io.mjs');
    });

    beforeEach(() => {
        jest.clearAllMocks();
        // Reset env
        process.env.GOOGLE_CLIENT_ID = 'test-client-id';
        process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
        process.env.GOOGLE_REDIRECT_URI = 'http://localhost/callback';
        process.env.OPENAI_API_KEY = 'test-key';
    });

    describe('buildReceiptQuery', () => {
        const defaultRetailers = [
            {
                id: 'amazon',
                name: 'Amazon',
                senders: ['shipment-tracking@amazon.com', 'auto-confirm@amazon.com'],
                keywords: ['order', 'shipment']
            },
            {
                id: 'target',
                name: 'Target',
                senders: ['orders@target.com'],
                keywords: ['order', 'receipt']
            }
        ];

        it('should build query for all retailers', () => {
            const query = shopping.buildReceiptQuery({
                retailers: defaultRetailers
            });

            expect(query).toContain('from:shipment-tracking@amazon.com');
            expect(query).toContain('from:auto-confirm@amazon.com');
            expect(query).toContain('from:orders@target.com');
            expect(query).toContain('subject:order');
        });

        it('should filter to specific retailer', () => {
            const query = shopping.buildReceiptQuery({
                retailers: defaultRetailers,
                retailerFilter: 'amazon'
            });

            expect(query).toContain('from:shipment-tracking@amazon.com');
            expect(query).not.toContain('from:orders@target.com');
        });

        it('should add date filter when since provided', () => {
            const query = shopping.buildReceiptQuery({
                retailers: defaultRetailers,
                since: '2025-01-01',
                timezone: 'America/Chicago'
            });

            expect(query).toContain('after:2025/01/01');
        });

        it('should throw if no retailers match filter', () => {
            expect(() => shopping.buildReceiptQuery({
                retailers: defaultRetailers,
                retailerFilter: 'nonexistent'
            })).toThrow(/No retailers configured/);
        });

        it('should throw if no retailers configured', () => {
            expect(() => shopping.buildReceiptQuery({
                retailers: []
            })).toThrow(/No retailers configured/);
        });
    });

    describe('parseEmailContent', () => {
        it('should extract headers and body from message', () => {
            const message = {
                id: 'msg123',
                threadId: 'thread456',
                snippet: 'Order confirmed...',
                payload: {
                    mimeType: 'text/plain',
                    headers: [
                        { name: 'Subject', value: 'Your Amazon order' },
                        { name: 'From', value: 'shipment-tracking@amazon.com' },
                        { name: 'Date', value: 'Mon, 30 Dec 2025 10:00:00 -0600' }
                    ],
                    body: {
                        data: Buffer.from('Order details here').toString('base64')
                    }
                }
            };

            const parsed = shopping.parseEmailContent(message);

            expect(parsed.id).toBe('msg123');
            expect(parsed.threadId).toBe('thread456');
            expect(parsed.subject).toBe('Your Amazon order');
            expect(parsed.from).toBe('shipment-tracking@amazon.com');
            expect(parsed.body).toBe('Order details here');
            expect(parsed.snippet).toBe('Order confirmed...');
        });

        it('should handle multipart messages', () => {
            const message = {
                id: 'msg123',
                snippet: 'snippet',
                payload: {
                    mimeType: 'multipart/alternative',
                    headers: [],
                    parts: [
                        {
                            mimeType: 'text/plain',
                            body: {
                                data: Buffer.from('Plain text body').toString('base64')
                            }
                        },
                        {
                            mimeType: 'text/html',
                            body: {
                                data: Buffer.from('<p>HTML body</p>').toString('base64')
                            }
                        }
                    ]
                }
            };

            const parsed = shopping.parseEmailContent(message);
            expect(parsed.body).toBe('Plain text body');
        });

        it('should fall back to snippet if no body', () => {
            const message = {
                id: 'msg123',
                snippet: 'The snippet content',
                payload: {
                    mimeType: 'text/plain',
                    headers: []
                }
            };

            const parsed = shopping.parseEmailContent(message);
            expect(parsed.body).toBe('The snippet content');
        });
    });

    describe('identifyRetailer', () => {
        const retailers = [
            {
                id: 'amazon',
                name: 'Amazon',
                senders: ['shipment-tracking@amazon.com', 'auto-confirm@amazon.com']
            },
            {
                id: 'target',
                name: 'Target',
                senders: ['orders@target.com']
            }
        ];

        it('should identify Amazon emails', () => {
            const email = { from: 'shipment-tracking@amazon.com' };
            const result = shopping.identifyRetailer(email, retailers);
            expect(result.id).toBe('amazon');
        });

        it('should identify Target emails', () => {
            const email = { from: 'orders@target.com' };
            const result = shopping.identifyRetailer(email, retailers);
            expect(result.id).toBe('target');
        });

        it('should return null for unknown sender', () => {
            const email = { from: 'unknown@example.com' };
            const result = shopping.identifyRetailer(email, retailers);
            expect(result).toBeNull();
        });

        it('should be case-insensitive', () => {
            const email = { from: 'SHIPMENT-TRACKING@AMAZON.COM' };
            const result = shopping.identifyRetailer(email, retailers);
            expect(result.id).toBe('amazon');
        });
    });

    describe('generateReceiptId', () => {
        it('should generate ID from source, date, and order ID', () => {
            const id = shopping.generateReceiptId('amazon', '2025-12-25', 'ORDER-123');
            expect(id).toBe('amazon_2025-12-25_order-123');
        });

        it('should handle special characters', () => {
            const id = shopping.generateReceiptId('amazon', '2025-12-25', 'ORDER#123!@$');
            expect(id).toBe('amazon_2025-12-25_order_123___');
        });

        it('should handle missing parts', () => {
            const id = shopping.generateReceiptId('amazon', null, 'msgid');
            expect(id).toBe('amazon_msgid');
        });
    });

    describe('mergeReceipts', () => {
        it('should add new receipts and keep existing', () => {
            const existing = [
                { id: 'rec1', date: '2025-12-20', total: 50 },
                { id: 'rec2', date: '2025-12-21', total: 30 }
            ];
            const incoming = [
                { id: 'rec3', date: '2025-12-22', total: 40 },
                { id: 'rec2', date: '2025-12-21', total: 30 } // duplicate
            ];

            const result = shopping.mergeReceipts(existing, incoming);

            expect(result).toHaveLength(3);
            expect(result.map(r => r.id)).toContain('rec1');
            expect(result.map(r => r.id)).toContain('rec2');
            expect(result.map(r => r.id)).toContain('rec3');
        });

        it('should sort by date descending', () => {
            const existing = [{ id: 'rec1', date: '2025-12-20' }];
            const incoming = [
                { id: 'rec2', date: '2025-12-25' },
                { id: 'rec3', date: '2025-12-15' }
            ];

            const result = shopping.mergeReceipts(existing, incoming);

            expect(result[0].id).toBe('rec2'); // newest
            expect(result[result.length - 1].id).toBe('rec3'); // oldest
        });

        it('should handle empty arrays', () => {
            expect(shopping.mergeReceipts([], [])).toEqual([]);
            expect(shopping.mergeReceipts([], [{ id: 'rec1', date: '2025-01-01' }])).toHaveLength(1);
            expect(shopping.mergeReceipts([{ id: 'rec1', date: '2025-01-01' }], [])).toHaveLength(1);
        });
    });

    describe('extractReceiptData', () => {
        it('should call AI gateway with correct messages', async () => {
            const mockGateway = {
                chatWithJson: jest.fn().mockResolvedValue({
                    merchant: 'Amazon',
                    order_id: '123-456',
                    date: '2025-12-25',
                    total: 49.99,
                    items: [{ name: 'Widget', quantity: 1, unit_price: 49.99, total_price: 49.99 }]
                })
            };
            aiModule.getAIGateway.mockReturnValue(mockGateway);

            const email = {
                id: 'msg123',
                subject: 'Your order has shipped',
                body: 'Order #123-456\nWidget - $49.99\nTotal: $49.99'
            };

            const result = await shopping.extractReceiptData(email, 'Amazon');

            expect(mockGateway.chatWithJson).toHaveBeenCalled();
            expect(result.merchant).toBe('Amazon');
            expect(result.total).toBe(49.99);
            expect(result.items).toHaveLength(1);
        });

        it('should use gpt-4o-mini model', async () => {
            const mockGateway = {
                chatWithJson: jest.fn().mockResolvedValue({ total: 10 })
            };
            aiModule.getAIGateway.mockReturnValue(mockGateway);

            await shopping.extractReceiptData({ id: 'test', subject: 'test', body: 'test' }, 'Test');

            expect(mockGateway.chatWithJson).toHaveBeenCalledWith(
                expect.any(Array),
                expect.objectContaining({
                    model: 'gpt-4o-mini',
                    temperature: 0.1
                })
            );
        });
    });

    describe('loadShoppingConfig', () => {
        it('should return household config if available', () => {
            ioModule.householdLoadFile.mockReturnValue({
                shopping: {
                    enabled: true,
                    timezone: 'America/New_York',
                    retailers: [{ id: 'custom', name: 'Custom', senders: ['a@b.com'] }]
                }
            });

            const config = shopping.loadShoppingConfig('testuser');

            expect(config.timezone).toBe('America/New_York');
            expect(config.retailers[0].id).toBe('custom');
        });

        it('should use default config if household config missing', () => {
            ioModule.householdLoadFile.mockReturnValue(null);

            const config = shopping.loadShoppingConfig('testuser');

            expect(config.timezone).toBe('America/Chicago');
            expect(config.retailers[0].id).toBe('amazon');
        });

        it('should throw if shopping not enabled', () => {
            ioModule.householdLoadFile.mockReturnValue({
                shopping: { enabled: false }
            });

            expect(() => shopping.loadShoppingConfig('testuser'))
                .toThrow(/not enabled/);
        });
    });

    describe('formatLocalTimestamp', () => {
        it('should format date with timezone offset', () => {
            const result = shopping.formatLocalTimestamp('2025-12-25T12:00:00Z', 'America/Chicago');
            
            // Chicago is UTC-6 in winter
            expect(result).toContain('2025-12-25');
            expect(result).toContain('-06:00');
        });

        it('should handle different timezones', () => {
            const result = shopping.formatLocalTimestamp('2025-06-15T12:00:00Z', 'America/New_York');
            
            // New York is UTC-4 in summer (DST)
            expect(result).toContain('-04:00');
        });
    });
});
