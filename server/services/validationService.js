'use strict';

const pool = require('../db');
const { calculateFileHash } = require('../utils/fileUtils');

/**
 * Проверяет подлинность документа по его хэшу в блокчейне.
 * Для авторизованных пользователей сохраняет запрос в историю.
 * @param {Object} blockchain - Экземпляр блокчейна.
 * @param {Object} file - Загруженный файл (multer file object).
 * @param {number|null} userId - ID авторизованного пользователя или null для анонимного.
 * @returns {Promise<Object>} Результат проверки { isValid, status, message }.
 */
async function checkDocument(blockchain, file, userId) {
    // Вычисляем хэш файла
    const documentHash = calculateFileHash(file.buffer);

    // Проверяем документ в блокчейне
    const result = blockchain.checkDocument(documentHash);

    // Если пользователь авторизован, сохраняем запрос в БД
    if (userId !== null) {
        try {
            await pool.query(
                'INSERT INTO verification_requests (user_id, document_hash, result) VALUES (?, ?, ?)',
                [userId, documentHash, result.status]
            );
        } catch (error) {
            // Логируем ошибку сохранения истории, но не прерываем проверку
            // Это не критичная операция - основная функциональность работает
            console.error('Failed to save verification request:', error.message);
        }
    }

    return {
        isValid: result.isValid,
        status: result.status,
        message: result.status === 'VALID' 
            ? 'Document is authentic' 
            : result.status === 'REVOKED'
                ? 'Document has been revoked'
                : 'Document not found in registry'
    };
}

/**
 * Получает историю проверок документов пользователя.
 * @param {number} userId - ID пользователя.
 * @returns {Promise<Array>} Массив запросов проверки, отсортированный по дате (новые первые).
 */
async function getVerificationHistory(userId) {
    const [requests] = await pool.query(
        'SELECT * FROM verification_requests WHERE user_id = ? ORDER BY created_at DESC',
        [userId]
    );
    return requests;
}

module.exports = {
    checkDocument,
    getVerificationHistory
};