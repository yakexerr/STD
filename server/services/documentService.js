'use strict';

const fs = require('fs').promises;
const path = require('path');
const pool = require('../db');
const config = require('../config');
const { calculateFileHash } = require('../utils/fileUtils');

/**
 * Выпускает новый документ с использованием транзакций для обеспечения консистентности
 * между базой данных и блокчейном.
 * @param {Object} blockchain - Экземпляр блокчейна.
 * @param {number} issuerId - ID эмитента.
 * @param {string} type - Тип документа ('CERTIFICATE' или 'DIPLOMA').
 * @param {string} holderEmail - Email владельца.
 * @param {Object} file - Загруженный файл (multer file object).
 * @returns {Promise<Object>} Результат выпуска { documentId, message }.
 * @throws {Error} Если holder не найден или имеет неверную роль.
 * @throws {Error} Если произошла ошибка при создании документа.
 */
async function issueDocument(blockchain, issuerId, type, holderEmail, file) {
    // Находим holder по email
    const [holders] = await pool.query(
        'SELECT id, role FROM users WHERE email = ?',
        [holderEmail]
    );

    if (holders.length === 0) {
        throw new Error('Holder not found');
    }

    const holder = holders[0];
    if (holder.role !== 'HOLDER') {
        throw new Error('User must have HOLDER role');
    }

    const holderId = holder.id;

    // Генерируем UUID для имени файла
    const crypto = require('crypto');
    const fileUUID = crypto.randomUUID();
    const fileName = `${fileUUID}.pdf`;
    const filePath = path.join(config.UPLOADS_DIR, fileName);

    // Сохраняем файл на диск
    await fs.writeFile(filePath, file.buffer);

    const connection = await pool.getConnection();
    try {
        // Начинаем транзакцию для обеспечения атомарности операции
        await connection.beginTransaction();
        
        // Вычисляем хэш файла
        const documentHash = calculateFileHash(file.buffer);

        // 1. Сначала вставляем в БД
        const [result] = await connection.query(
            'INSERT INTO documents (type, issuer_id, holder_id, file_name, document_hash) VALUES (?, ?, ?, ?, ?)',
            [type, issuerId, holderId, fileName, documentHash]
        );
        
        const dbDocumentId = result.insertId;
        
        // 2. Потом добавляем в блокчейн
        // Используем ID из БД как documentId для блокчейна
        blockchain.issueDocument(
            dbDocumentId.toString(),
            documentHash,
            issuerId.toString(),
            holderId.toString()
        );
        
        // Коммитим транзакцию только если всё прошло успешно
        await connection.commit();
        
        return {
            documentId: dbDocumentId,
            message: 'Document issued successfully'
        };
    } catch (error) {
        // Откатываем транзакцию при любой ошибке
        await connection.rollback();
        
        // Удаляем файл если он был создан
        try {
            await fs.unlink(filePath);
        } catch (unlinkError) {
            // Игнорируем ошибку удаления файла
        }
        
        throw error;
    } finally {
        // Всегда освобождаем соединение
        connection.release();
    }
}

/**
 * Отзывает документ с использованием транзакций для обеспечения консистентности.
 * @param {Object} blockchain - Экземпляр блокчейна.
 * @param {number} issuerId - ID эмитента, выполняющего отзыв.
 * @param {number} documentId - ID документа в базе данных.
 * @returns {Promise<Object>} Результат отзыва { message }.
 * @throws {Error} Если документ не найден.
 * @throws {Error} Если эмитент не имеет прав на отзыв.
 */
async function revokeDocument(blockchain, issuerId, documentId) {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        
        // Получаем документ из БД
        const [documents] = await connection.query(
            'SELECT * FROM documents WHERE id = ?',
            [documentId]
        );

        if (documents.length === 0) {
            throw new Error('Document not found');
        }

        const document = documents[0];

        // Проверяем права: только эмитент может отозвать свой документ
        if (document.issuer_id !== issuerId) {
            throw new Error('Not authorized to revoke this document');
        }

        // 1. Сначала обновляем статус в БД
        await connection.query(
            'UPDATE documents SET status = ? WHERE id = ?',
            ['REVOKED', documentId]
        );

        // 2. Потом добавляем блок отзыва в блокчейн
        blockchain.revokeDocument(documentId.toString());

        await connection.commit();

        return {
            message: 'Document revoked successfully'
        };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

/**
 * Получает список документов пользователя в зависимости от его роли.
 * @param {number} userId - ID пользователя.
 * @param {string} role - Роль пользователя ('ISSUER' или 'HOLDER').
 * @returns {Promise<Array>} Массив документов пользователя.
 */
async function getMyDocuments(userId, role) {
    let query;
    
    if (role === 'HOLDER') {
        query = 'SELECT * FROM documents WHERE holder_id = ? ORDER BY issued_at DESC';
    } else if (role === 'ISSUER') {
        query = 'SELECT * FROM documents WHERE issuer_id = ? ORDER BY issued_at DESC';
    } else {
        return [];
    }

    const [documents] = await pool.query(query, [userId]);
    return documents;
}

module.exports = {
    issueDocument,
    revokeDocument,
    getMyDocuments
};