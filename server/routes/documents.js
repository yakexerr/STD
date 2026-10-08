'use strict';

const express = require('express');
const { authenticateToken, requireRole } = require('../middleware/auth');
const upload = require('../middleware/upload');
const documentService = require('../services/documentService');

const router = express.Router();

/**
 * Выпуск нового документа.
 * Требует авторизацию и роль ISSUER.
 * Multer обрабатывает файл ДО проверки авторизации.
 * @route POST /api/documents/issue
 */
router.post('/issue',
    upload.single('document'),
    authenticateToken,
    requireRole('ISSUER'),
    async (req, res) => {
        try {
            const { type, holderEmail } = req.body;

            if (!req.file) {
                return res.status(400).json({ error: 'Document file is required' });
            }

            if (!type || !['CERTIFICATE', 'DIPLOMA'].includes(type)) {
                return res.status(400).json({ error: 'Type must be CERTIFICATE or DIPLOMA' });
            }

            if (!holderEmail) {
                return res.status(400).json({ error: 'Holder email is required' });
            }

            const blockchain = req.app.get('blockchain');
            const result = await documentService.issueDocument(
                blockchain,
                req.user.id,
                type,
                holderEmail,
                req.file
            );

            res.status(201).json(result);
        } catch (error) {
            if (error.message.includes('not found') || 
                error.message.includes('already exists') ||
                error.message.includes('must have')) {
                return res.status(400).json({ error: error.message });
            }
            res.status(500).json({ error: 'Internal server error' });
        }
    }
);

/**
 * Отзыв документа.
 * Требует авторизацию и роль ISSUER.
 * Только эмитент может отозвать свой документ.
 * @route POST /api/documents/revoke
 */
router.post('/revoke', authenticateToken, requireRole('ISSUER'), async (req, res) => {
    try {
        const { documentId } = req.body;

        if (!documentId) {
            return res.status(400).json({ error: 'Document ID is required' });
        }

        const blockchain = req.app.get('blockchain');
        const result = await documentService.revokeDocument(
            blockchain,
            req.user.id,
            documentId
        );

        res.status(200).json(result);
    } catch (error) {
        if (error.message.includes('not found') || 
            error.message.includes('not authorized')) {
            return res.status(403).json({ error: error.message });
        }
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * Получение списка документов пользователя.
 * HOLDER видит документы, где он владелец.
 * ISSUER видит документы, которые он выпустил.
 * @route GET /api/documents/my
 */
router.get('/my', authenticateToken, async (req, res) => {
    try {
        const documents = await documentService.getMyDocuments(req.user.id, req.user.role);
        res.status(200).json({ documents });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;