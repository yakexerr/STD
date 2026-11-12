'use strict';

const express = require('express');
const config = require('../config');
const p2pService = require('../services/p2pService');

const router = express.Router();

// Маппинг кодов ошибок ядра на HTTP-статусы по контракту §3.4
const ERROR_STATUS_MAP = {
    LOCAL_CHAIN_TAMPERED: 503,
    INVALID_FORMAT: 400,
    INVALID_TYPE: 422,
    INVALID_HASH: 422,
    BLOCK_CONFLICT: 409,
    CHAIN_GAP: 409,
    PREV_HASH_MISMATCH: 422,
    DUPLICATE_DOCUMENT: 422,
    DOCUMENT_NOT_FOUND: 422,
    ALREADY_REVOKED: 422
};

function sendP2PError(res, status, code, message, details = {}) {
    return res.status(status).json({
        error: {
            code,
            message,
            details
        }
    });
}

// Middleware проверки X-Network-Token
function verifyNetworkToken(req, res, next) {
    if (!config.NETWORK_TOKEN) {
        return next();
    }
    const token = req.headers['x-network-token'];
    if (!token || token !== config.NETWORK_TOKEN) {
        return sendP2PError(res, 401, 'UNAUTHORIZED', 'Invalid or missing X-Network-Token header');
    }
    next();
}

router.use(verifyNetworkToken);

/**
 * GET /api/node/info
 */
router.get('/info', (req, res) => {
    const blockchain = req.app.get('blockchain');
    const genesis = blockchain.chain[0];
    const latest = blockchain.getLatestBlock();

    res.status(200).json({
        nodeId: config.NODE_ID,
        version: '1.0',
        networkId: genesis ? genesis.hash : null,
        chainLength: blockchain.getChainLength(),
        latestBlock: latest
            ? {
                index: latest.index,
                hash: latest.hash,
                type: latest.type,
                timestamp: latest.timestamp
            }
            : null,
        peers: config.PEERS
    });
});

/**
 * GET /api/node/blocks?fromIndex=&limit=
 */
router.get('/blocks', (req, res) => {
    const blockchain = req.app.get('blockchain');

    let fromIndex = 0;
    if (req.query.fromIndex !== undefined) {
        if (!/^\d+$/.test(String(req.query.fromIndex))) {
            return sendP2PError(res, 400, 'INVALID_PARAMS', 'fromIndex must be an integer >= 0', {
                param: 'fromIndex'
            });
        }
        fromIndex = Number(req.query.fromIndex);
    }

    let limit = 100;
    if (req.query.limit !== undefined) {
        if (!/^\d+$/.test(String(req.query.limit))) {
            return sendP2PError(res, 400, 'INVALID_PARAMS', 'limit must be an integer between 1 and 1000', {
                param: 'limit'
            });
        }
        limit = Number(req.query.limit);
        if (limit < 1 || limit > 1000) {
            return sendP2PError(res, 400, 'INVALID_PARAMS', 'limit must be between 1 and 1000', {
                param: 'limit'
            });
        }
    }

    const blocks = blockchain.getBlocks(fromIndex, limit);

    res.status(200).json({
        fromIndex,
        limit,
        total: blockchain.getChainLength(),
        count: blocks.length,
        blocks
    });
});

/**
 * GET /api/node/blocks/:index
 */
router.get('/blocks/:index', (req, res) => {
    const blockchain = req.app.get('blockchain');
    const rawIndex = req.params.index;

    if (!/^\d+$/.test(rawIndex)) {
        return sendP2PError(res, 400, 'INVALID_PARAMS', 'Block index must be a non-negative integer', {
            param: 'index'
        });
    }

    const index = Number(rawIndex);
    const chainLength = blockchain.getChainLength();

    if (index < 0 || index >= chainLength) {
        return sendP2PError(res, 404, 'BLOCK_NOT_FOUND', `Block #${index} not found`, {
            index,
            chainLength
        });
    }

    res.status(200).json({
        block: blockchain.chain[index].toJSON()
    });
});

/**
 * POST /api/node/blocks
 */
router.post('/blocks', (req, res) => {
    const blockchain = req.app.get('blockchain');

    if (!req.body || typeof req.body !== 'object' || !('block' in req.body)) {
        return sendP2PError(res, 400, 'INVALID_FORMAT', 'Request body must contain "block" field', {
            field: 'block',
            problem: 'missing block wrapper'
        });
    }

    try {
        const result = blockchain.addExternalBlock(req.body.block);
        if (result.accepted) {
            return res.status(201).json(result);
        }
        return res.status(200).json(result);
    } catch (err) {
        const status = ERROR_STATUS_MAP[err.code] || 500;
        const code = err.code || 'INTERNAL_ERROR';
        return sendP2PError(res, status, code, err.message, err.details || {});
    }
});

/**
 * POST /api/node/sync
 */
router.post('/sync', async (req, res) => {
    const blockchain = req.app.get('blockchain');
    const { peerUrl } = req.body || {};

    if (peerUrl !== undefined) {
        if (typeof peerUrl !== 'string' || !/^https?:\/\/.+/.test(peerUrl.trim())) {
            return sendP2PError(res, 400, 'INVALID_PARAMS', 'peerUrl must be a valid http(s) URL', {
                field: 'peerUrl'
            });
        }
    }

    try {
        const syncResult = await p2pService.syncPeers(blockchain, peerUrl ? peerUrl.trim() : null);
        return res.status(200).json(syncResult);
    } catch (err) {
        return sendP2PError(res, 500, 'INTERNAL_ERROR', err.message);
    }
});

module.exports = router;