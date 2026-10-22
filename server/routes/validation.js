'use strict';

const express = require('express');
const { optionalAuth } = require('../middleware/optionalAuth');
const { authenticateToken } = require('../middleware/auth');
const upload = require('../middleware/upload');
const validationService = require('../services/validationService');

const router = express.Router();

/**
 * Проверка подлинности документа.
 * Поддерживает как анонимных, так и авторизованных пользователей.
 * Для авторизованных пользователей сохраняет историю проверок.
 * @route POST /api/validation/check
 */
router.post('/check', optionalAuth, upload.single('document'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Document file is required' });
        }

        const blockchain = req.app.get('blockchain');
        const userId = req.user ? req.user.id : null;

        const result = await validationService.checkDocument(blockchain, req.file, userId);
        res.status(200).json(result);
    } catch (error) {
        console.error('VALIDATION ERROR:', error.message);

        if (error.code === 'BLOCKCHAIN_TAMPERED' || (error.message && error.message.includes('Blockchain integrity check failed'))) {
            return res.status(500).json({
                status: 'ERROR',
                error: 'Blockchain integrity check failed',
                message: 'Реестр документов скомпрометирован: данные blockchain.json были изменены извне. Проверка недоступна.',
                details: {
                    blockIndex: error.details?.blockIndex ?? null,
                    blockHash: error.details?.blockHash ?? null,
                    reason: error.details?.reason || error.message
                }
            });
        }

        res.status(500).json({ error: error.message || 'Internal server error' });
    }
});

/**
 * Получение истории проверок авторизованного пользователя.
 * @route GET /api/validation/history
 */
router.get('/history', authenticateToken, async (req, res) => {
    try {
        const requests = await validationService.getVerificationHistory(req.user.id);
        res.status(200).json({ requests });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;