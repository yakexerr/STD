'use strict';

const { Blockchain, Block } = require('../blockchain');
const fs = require('fs');

// Мокаем fs, чтобы тесты не создавали реальный файл blockchain.json на диске
jest.mock('fs', () => ({
    existsSync: jest.fn(() => false),
    readFileSync: jest.fn(() => '[]'),
    writeFileSync: jest.fn()
}));

describe('Blockchain Core Suite', () => {
    let bc;

    beforeEach(() => {
        jest.clearAllMocks();
        bc = new Blockchain('dummy-path.json');
    });

    it('должен инициализировать блокчейн с genesis-блоком (тип BEGIN)', () => {
        expect(bc.getChainLength()).toBe(1);
        const genesis = bc.getLatestBlock();
        expect(genesis.index).toBe(0);
        expect(genesis.type).toBe('BEGIN');
        expect(bc.isValid()).toBe(true);
    });

    it('должен успешно регистрировать выпуск нового документа (ISSUE)', () => {
        const block = bc.issueDocument('doc-1', 'hash-123', 'issuer-1', 'holder-1');
        
        expect(block.type).toBe('ISSUE');
        expect(block.data.documentId).toBe('doc-1');
        expect(bc.getChainLength()).toBe(2);
        expect(bc.isValid()).toBe(true);
    });

    it('должен выбрасывать ошибку при попытке выпустить документ с существующим ID или хэшем', () => {
        bc.issueDocument('doc-1', 'hash-123', 'issuer-1', 'holder-1');

        // Попытка с тем же ID
        expect(() => {
            bc.issueDocument('doc-1', 'hash-999', 'issuer-1', 'holder-1');
        }).toThrow(/already exists/i);

        // Попытка с тем же хэшем
        expect(() => {
            bc.issueDocument('doc-2', 'hash-123', 'issuer-1', 'holder-1');
        }).toThrow(/already exists/i);
    });

    it('должен корректно обрабатывать отзыв документа (REVOKE)', () => {
        bc.issueDocument('doc-1', 'hash-123', 'issuer-1', 'holder-1');
        const revokeBlock = bc.revokeDocument('doc-1');

        expect(revokeBlock.type).toBe('REVOKE');
        expect(bc.getChainLength()).toBe(3);

        // Проверяем статус через checkDocument
        const check = bc.checkDocument('hash-123');
        expect(check.status).toBe('REVOKED');
        expect(check.isValid).toBe(false);
    });

    it('должен возвращать false в isValid(), если цепочка была повреждена/модифицирована', () => {
        bc.issueDocument('doc-1', 'hash-123', 'issuer-1', 'holder-1');
        
        // Симулируем взломанные данные внутри блока
        bc.chain[1].data.holderId = 'hacker-id';

        expect(bc.isValid()).toBe(false);
    });
});