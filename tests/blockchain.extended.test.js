'use strict';

const { Blockchain, Block } = require('../blockchain');
const fs = require('fs');

jest.mock('fs', () => ({
    existsSync: jest.fn(() => false),
    readFileSync: jest.fn(() => '[]'),
    writeFileSync: jest.fn()
}));

describe('Blockchain Extended Suite', () => {
    let bc;

    beforeEach(() => {
        jest.clearAllMocks();
        fs.existsSync.mockReturnValue(false);
        fs.readFileSync.mockReturnValue('[]');
        bc = new Blockchain('dummy-path.json');
    });

    it('должен вычислять одинаковый хэш независимо от порядка ключей в data', () => {
        const ts = '2026-01-01T00:00:00.000Z';
        const b1 = new Block(1, ts, 'ISSUE', { b: 2, a: 1, nested: { z: 9, m: 5 } }, '0');
        const b2 = new Block(1, ts, 'ISSUE', { nested: { m: 5, z: 9 }, a: 1, b: 2 }, '0');
        expect(b1.hash).toBe(b2.hash);
        expect(b1.hash).toHaveLength(64);
    });

    it('toJSON должен возвращать все поля блока', () => {
        expect(bc.getLatestBlock().toJSON()).toEqual({
            index: 0,
            timestamp: expect.any(String),
            type: 'BEGIN',
            data: {},
            previousHash: '0',
            hash: expect.stringMatching(/^[a-f0-9]{64}$/)
        });
    });

    it('load() должен создавать genesis-блок при пустом файле, загружать валидную цепочку и отклонять битый JSON', () => {
        fs.existsSync.mockReturnValue(true);
        fs.readFileSync.mockReturnValue('   \n  ');
        const loadedEmpty = new Blockchain('empty.json');
        expect(loadedEmpty.getChainLength()).toBe(1);

        bc.issueDocument('doc-1', 'hash-1', 'issuer-1', 'holder-1');
        fs.readFileSync.mockReturnValue(JSON.stringify(bc.chain));
        const loadedValid = new Blockchain('valid.json');
        expect(loadedValid.getChainLength()).toBe(2);
        expect(loadedValid.checkDocument('hash-1')).toEqual({ isValid: true, status: 'VALID' });

        fs.readFileSync.mockReturnValue('{"not":"an array"}');
        expect(() => new Blockchain('bad.json')).toThrow('Blockchain file is corrupted: expected an array');

        fs.readFileSync.mockReturnValue('{broken json');
        expect(() => new Blockchain('broken.json')).toThrow(/Failed to load blockchain:/);
    });

    it('issueDocument/revokeDocument/checkDocument должны валидировать входные типы и состояния', () => {
        expect(() => bc.issueDocument('', 'h', 'i', 'u')).toThrow(TypeError);
        expect(() => bc.issueDocument('d', ' ', 'i', 'u')).toThrow(TypeError);
        expect(() => bc.issueDocument('d', 'h', null, 'u')).toThrow(TypeError);
        expect(() => bc.issueDocument('d', 'h', 'i', 123)).toThrow(TypeError);

        expect(() => bc.revokeDocument('')).toThrow(TypeError);
        expect(() => bc.revokeDocument('unknown-doc')).toThrow('Document unknown-doc not found');

        bc.issueDocument('doc-1', 'hash-1', 'issuer-1', 'holder-1');
        bc.revokeDocument('doc-1');
        expect(() => bc.revokeDocument('doc-1')).toThrow('Document doc-1 already revoked');

        expect(() => bc.checkDocument('')).toThrow(TypeError);
        expect(bc.checkDocument('missing-hash')).toEqual({ isValid: false, status: 'NOT_FOUND' });
    });

    it('validateChain и checkDocument должны выявлять подделку, пустую цепочку и разрыв связей', () => {
        bc.chain = [];
        expect(bc.validateChain().error.reason).toBe('Blockchain is empty');

        bc = new Blockchain('dummy.json');
        bc.chain[0].type = 'ISSUE';
        expect(bc.validateChain().error.reason).toContain('Genesis block has invalid type');

        bc = new Blockchain('dummy.json');
        bc.chain[0].previousHash = '123';
        expect(bc.validateChain().error.reason).toContain('Genesis block has invalid previousHash');

        bc = new Blockchain('dummy.json');
        bc.chain[0].index = 5;
        expect(bc.validateChain().error.reason).toContain('Genesis block has invalid index');

        bc = new Blockchain('dummy.json');
        bc.issueDocument('doc-1', 'hash-1', 'issuer-1', 'holder-1');
        bc.chain[1].previousHash = 'wrong-prev-hash';
        expect(bc.validateChain().error.reason).toContain('previousHash mismatch');

        bc = new Blockchain('dummy.json');
        bc.issueDocument('doc-1', 'hash-1', 'issuer-1', 'holder-1');
        bc.chain[1].index = 99;
        expect(bc.validateChain().error.reason).toContain('Index sequence broken');

        bc = new Blockchain('dummy.json');
        bc.issueDocument('doc-1', 'hash-1', 'issuer-1', 'holder-1');
        bc.chain[1].data.documentHash = 'tampered-hash';
        expect(() => bc.checkDocument('hash-1')).toThrow(/Blockchain integrity check failed/);
    });
});