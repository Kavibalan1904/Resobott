const { describe, it } = require('node:test');
const assert = require('node:assert');
const { getCozyTimeGreeting, nowPlayingEmbed } = require('../src/utils/embeds');
const { setTimezone, removeTimezone } = require('../src/utils/settings');

describe('Dynamic Time-Based Player Greetings', () => {
    it('should return Midday Chill and no coffee at 12:00 noon', () => {
        // Mock Date or test getCozyTimeGreeting with known timezone
        const originalDate = global.Date;
        try {
            // Mock Date to 12:00:00 UTC with UTC timezone
            class MockDate extends Date {
                constructor(...args) {
                    if (args.length === 0) {
                        super('2026-11-14T12:00:00Z');
                    } else {
                        super(...args);
                    }
                }
            }
            global.Date = MockDate;
            process.env.TIMEZONE = 'UTC';

            const greeting = getCozyTimeGreeting();
            assert.strictEqual(greeting.text, 'Midday Chill');
            assert.strictEqual(greeting.emoji, '☀️');
            assert.ok(!greeting.note.toLowerCase().includes('coffee'), 'Should not mention coffee at 12:00 noon');
            assert.ok(greeting.note.toLowerCase().includes('midday') || greeting.note.toLowerCase().includes('break'));
        } finally {
            global.Date = originalDate;
            delete process.env.TIMEZONE;
        }
    });

    it('should return Morning Brew & Beats with coffee emoji between 5:00 and 8:59 AM', () => {
        const originalDate = global.Date;
        try {
            class MockDate extends Date {
                constructor(...args) {
                    if (args.length === 0) {
                        super('2026-11-14T07:30:00Z');
                    } else {
                        super(...args);
                    }
                }
            }
            global.Date = MockDate;
            process.env.TIMEZONE = 'UTC';

            const greeting = getCozyTimeGreeting();
            assert.strictEqual(greeting.text, 'Morning Brew & Beats');
            assert.strictEqual(greeting.emoji, '☕');
            assert.ok(greeting.note.toLowerCase().includes('coffee'));
        } finally {
            global.Date = originalDate;
            delete process.env.TIMEZONE;
        }
    });

    it('should return Mid-Morning Groove between 9:00 and 11:59 AM', () => {
        const originalDate = global.Date;
        try {
            class MockDate extends Date {
                constructor(...args) {
                    if (args.length === 0) {
                        super('2026-11-14T10:30:00Z');
                    } else {
                        super(...args);
                    }
                }
            }
            global.Date = MockDate;
            process.env.TIMEZONE = 'UTC';

            const greeting = getCozyTimeGreeting();
            assert.strictEqual(greeting.text, 'Mid-Morning Groove');
            assert.strictEqual(greeting.emoji, '☀️');
            assert.ok(!greeting.note.toLowerCase().includes('coffee'));
        } finally {
            global.Date = originalDate;
            delete process.env.TIMEZONE;
        }
    });

    it('should return Afternoon Chill between 14:00 and 16:59', () => {
        const originalDate = global.Date;
        try {
            class MockDate extends Date {
                constructor(...args) {
                    if (args.length === 0) {
                        super('2026-11-14T15:00:00Z');
                    } else {
                        super(...args);
                    }
                }
            }
            global.Date = MockDate;
            process.env.TIMEZONE = 'UTC';

            const greeting = getCozyTimeGreeting();
            assert.strictEqual(greeting.text, 'Afternoon Chill');
            assert.strictEqual(greeting.emoji, '🍃');
        } finally {
            global.Date = originalDate;
            delete process.env.TIMEZONE;
        }
    });

    it('should return Sunset Melodies between 17:00 and 19:59', () => {
        const originalDate = global.Date;
        try {
            class MockDate extends Date {
                constructor(...args) {
                    if (args.length === 0) {
                        super('2026-11-14T18:00:00Z');
                    } else {
                        super(...args);
                    }
                }
            }
            global.Date = MockDate;
            process.env.TIMEZONE = 'UTC';

            const greeting = getCozyTimeGreeting();
            assert.strictEqual(greeting.text, 'Sunset Melodies');
            assert.strictEqual(greeting.emoji, '🌅');
        } finally {
            global.Date = originalDate;
            delete process.env.TIMEZONE;
        }
    });

    it('should return Evening Wind Down between 20:00 and 22:59', () => {
        const originalDate = global.Date;
        try {
            class MockDate extends Date {
                constructor(...args) {
                    if (args.length === 0) {
                        super('2026-11-14T21:00:00Z');
                    } else {
                        super(...args);
                    }
                }
            }
            global.Date = MockDate;
            process.env.TIMEZONE = 'UTC';

            const greeting = getCozyTimeGreeting();
            assert.strictEqual(greeting.text, 'Evening Wind Down');
            assert.strictEqual(greeting.emoji, '✨');
        } finally {
            global.Date = originalDate;
            delete process.env.TIMEZONE;
        }
    });

    it('should return Late Night Session between 23:00 and 04:59', () => {
        const originalDate = global.Date;
        try {
            class MockDate extends Date {
                constructor(...args) {
                    if (args.length === 0) {
                        super('2026-11-14T02:00:00Z');
                    } else {
                        super(...args);
                    }
                }
            }
            global.Date = MockDate;
            process.env.TIMEZONE = 'UTC';

            const greeting = getCozyTimeGreeting();
            assert.strictEqual(greeting.text, 'Late Night Session');
            assert.strictEqual(greeting.emoji, '🌙');
        } finally {
            global.Date = originalDate;
            delete process.env.TIMEZONE;
        }
    });

    it('should convert UTC server time to Asia/Kolkata correctly (e.g. 06:30 UTC = 12:00 IST)', () => {
        const originalDate = global.Date;
        try {
            class MockDate extends Date {
                constructor(...args) {
                    if (args.length === 0) {
                        super('2026-11-14T06:30:00Z'); // 6:30 AM UTC = 12:00 PM IST
                    } else {
                        super(...args);
                    }
                }
            }
            global.Date = MockDate;
            process.env.TIMEZONE = 'Asia/Kolkata';

            const greeting = getCozyTimeGreeting();
            assert.strictEqual(greeting.text, 'Midday Chill');
            assert.strictEqual(greeting.emoji, '☀️');
        } finally {
            global.Date = originalDate;
            delete process.env.TIMEZONE;
        }
    });

    it('nowPlayingEmbed should render noon greeting and matching footer emoji at 12:00', () => {
        const originalDate = global.Date;
        try {
            class MockDate extends Date {
                constructor(...args) {
                    if (args.length === 0) {
                        super('2026-11-14T12:00:00Z');
                    } else {
                        super(...args);
                    }
                }
            }
            global.Date = MockDate;
            process.env.TIMEZONE = 'UTC';

            const track = {
                info: {
                    title: 'Daylight',
                    author: 'David Kushner',
                    uri: 'https://open.spotify.com/track/xyz',
                    duration: 210000,
                    sourceName: 'spotify',
                },
                requester: { username: 'kavi' },
            };
            const mockPlayer = {
                guildId: 'g_time_test',
                volume: 50,
                repeatMode: 'off',
                position: 45000,
                queue: { tracks: [] },
            };

            const embed = nowPlayingEmbed(track, mockPlayer, null, []);
            assert.ok(embed.data.author.name.includes('☀️ Midday Chill • Now Playing'));
            assert.ok(embed.data.description.includes('Relaxing rhythms for your midday break'));
            assert.ok(embed.data.footer.text.includes('Reso  ☀️'));
        } finally {
            global.Date = originalDate;
            delete process.env.TIMEZONE;
        }
    });
});
