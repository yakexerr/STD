'use strict';

const crypto = require('crypto');

/**
 * Вычисляет SHA-256 хэш содержимого файла.
 * Используется для создания уникального идентификатора документа
 * на основе его содержимого.
 * @param {Buffer} fileBuffer - Буфер файла (содержимое файла в памяти).
 * @returns {string} Hex-строка SHA-256 хэша длиной 64 символа.
 */
function calculateFileHash(fileBuffer) {
    return crypto.createHash('sha256').update(fileBuffer).digest('hex');
}

module.exports = {
    calculateFileHash
};