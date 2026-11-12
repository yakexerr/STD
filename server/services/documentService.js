'use strict';

const fs = require('fs').promises;
const path = require('path');
const pool = require('../db');
const config = require('../config');
const { calculateFileHash } = require('../utils/fileUtils');
const p2pService = require('./p2pService');

/**
 * Выпускает новый документ с использованием транзакций для обеспечения консистентности
 * между базой данных и блокчейном, а затем рассылает новый блок соседям.
 */
async function issueDocument(blockchain, issuerId, type, holderEmail, file) {
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

    const crypto = require('crypto');
    const fileUUID = crypto.randomUUID();
    const fileName = `${fileUUID}.pdf`;
    const filePath = path.join(config.UPLOADS_DIR, fileName);

    await fs.writeFile(filePath, file.buffer);

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const documentHash = calculateFileHash(file.buffer);

        // 1. Сначала вставляем в БД
        const [result] = await connection.query(
            'INSERT INTO documents (type, issuer_id, holder_id, file_name, document_hash) VALUES (?, ?, ?, ?, ?)',
            [type, issuerId, holderId, fileName, documentHash]
        );

        const dbDocumentId = result.insertId;

        // 2. Потом добавляем в блокчейн
        const createdBlock = blockchain.issueDocument(
            dbDocumentId.toString(),
            documentHash,
            issuerId.toString(),
            holderId.toString()
        );

        // Коммитим транзакцию
        await connection.commit();

        // 3. Рассылаем новый блок соседям после успешного commit
        await p2pService.broadcastBlock(createdBlock);

        return {
            documentId: dbDocumentId,
            message: 'Document issued successfully'
        };
    } catch (error) {
        await connection.rollback();

        try {
            await fs.unlink(filePath);
        } catch (unlinkError) {
            // Игнорируем ошибку удаления файла
        }

        throw error;
    } finally {
        connection.release();
    }
}

/**
 * Отзывает документ с использованием транзакций и рассылает блок отзыва соседям.
 */
async function revokeDocument(blockchain, issuerId, documentId) {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [documents] = await connection.query(
            'SELECT * FROM documents WHERE id = ?',
            [documentId]
        );

        if (documents.length === 0) {
            throw new Error('Document not found');
        }

        const document = documents[0];

        if (document.issuer_id !== issuerId) {
            throw new Error('Not authorized to revoke this document');
        }

        // 1. Сначала обновляем статус в БД
        await connection.query(
            'UPDATE documents SET status = ? WHERE id = ?',
            ['REVOKED', documentId]
        );

        // 2. Потом добавляем блок отзыва в блокчейн
        const revokeBlock = blockchain.revokeDocument(documentId.toString());

        await connection.commit();

        // 3. Рассылаем новый блок соседям после успешного commit
        await p2pService.broadcastBlock(revokeBlock);

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