'use strict';

const { calculateFileHash } = require('../server/utils/fileUtils');

describe('File Utils Suite', () => {
    it('должен корректно вычислять SHA-256 хэш из буфера файла', () => {
        const buffer = Buffer.from('test-pdf-content');
        const hash = calculateFileHash(buffer);

        // Длина SHA-256 хэша в hex-формате всегда равна 64 символам
        expect(typeof hash).toBe('string');
        expect(hash.length).toBe(64);
        
        // Хэш должен быть детерминированным (одинаковый буфер -> одинаковый хэш)
        const secondHash = calculateFileHash(buffer);
        expect(hash).toBe(secondHash);
    });
});