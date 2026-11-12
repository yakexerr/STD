'use strict';

const config = require('../config');

/**
 * Выполняет HTTP-запрос к соседней ноде с таймаутом и заголовком X-Network-Token.
 */
async function fetchPeer(url, options = {}, timeoutMs = config.P2P_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {})
    };
    if (config.NETWORK_TOKEN) {
        headers['X-Network-Token'] = config.NETWORK_TOKEN;
    }

    try {
        const response = await fetch(url, {
            ...options,
            headers,
            signal: controller.signal
        });
        return response;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Рассылает новый блок всем соседям из PEERS (push после commit в БД).
 * Недоставка или отказ логируются и не прерывают бизнес-операцию.
 * @param {Object} block - Экземпляр Block или plain-объект блока.
 */
async function broadcastBlock(block) {
    if (!config.PEERS || config.PEERS.length === 0) {
        return;
    }

    const payload = JSON.stringify({
        block: typeof block.toJSON === 'function' ? block.toJSON() : block
    });

    await Promise.allSettled(
        config.PEERS.map(async (peerUrl) => {
            try {
                const res = await fetchPeer(`${peerUrl}/api/node/blocks`, {
                    method: 'POST',
                    body: payload
                });
                const body = await res.json().catch(() => ({}));
                if (res.ok) {
                    const statusText = body.accepted ? 'accepted' : body.reason || 'ok';
                    console.log(`[p2p] block #${block.index} → ${peerUrl}: ${res.status} ${statusText}`);
                } else {
                    const errCode = body.error?.code || 'ERROR';
                    console.warn(`[p2p] block #${block.index} → ${peerUrl}: ${res.status} ${errCode}`);
                }
            } catch (err) {
                console.error(`[p2p] block #${block.index} → ${peerUrl}: failed (${err.message})`);
            }
        })
    );
}

/**
 * Синхронизирует локальный блокчейн с одним соседом (pull).
 */
async function syncWithPeer(blockchain, peerUrl) {
    const cleanUrl = peerUrl.replace(/\/+$/, '');
    let fetched = 0;
    let applied = 0;

    // 1. Запрос /api/node/info
    let peerInfo;
    try {
        const infoRes = await fetchPeer(`${cleanUrl}/api/node/info`, { method: 'GET' });
        if (!infoRes.ok) {
            return {
                peer: cleanUrl,
                ok: false,
                fetched: 0,
                applied: 0,
                error: { code: 'PEER_UNAVAILABLE', message: `HTTP ${infoRes.status}` }
            };
        }
        peerInfo = await infoRes.json();
    } catch (err) {
        return {
            peer: cleanUrl,
            ok: false,
            fetched: 0,
            applied: 0,
            error: {
                code: 'PEER_UNAVAILABLE',
                message: err.name === 'AbortError' ? 'timeout' : err.message
            }
        };
    }

    // 2. Проверка совместимости сети по genesis
    const localGenesisHash = blockchain.chain[0]?.hash;
    if (peerInfo.networkId !== localGenesisHash) {
        return {
            peer: cleanUrl,
            ok: false,
            fetched: 0,
            applied: 0,
            error: {
                code: 'GENESIS_MISMATCH',
                message: 'Peer belongs to a different blockchain network'
            }
        };
    }

    // 3. Докачиваем недостающие блоки батчами по 100
    while (peerInfo.chainLength > blockchain.getChainLength()) {
        const fromIndex = blockchain.getChainLength();
        let blocksData;
        try {
            const blocksRes = await fetchPeer(
                `${cleanUrl}/api/node/blocks?fromIndex=${fromIndex}&limit=100`,
                { method: 'GET' }
            );
            if (!blocksRes.ok) {
                return {
                    peer: cleanUrl,
                    ok: false,
                    fetched,
                    applied,
                    error: { code: 'PEER_UNAVAILABLE', message: `HTTP ${blocksRes.status}` }
                };
            }
            blocksData = await blocksRes.json();
        } catch (err) {
            return {
                peer: cleanUrl,
                ok: false,
                fetched,
                applied,
                error: { code: 'PEER_UNAVAILABLE', message: err.message }
            };
        }

        const blocks = blocksData.blocks || [];
        if (blocks.length === 0) {
            break;
        }

        // 4. Применяем по одному блоку через addExternalBlock
        for (const extBlock of blocks) {
            fetched += 1;
            try {
                const res = blockchain.addExternalBlock(extBlock);
                if (res.accepted) {
                    applied += 1;
                }
            } catch (err) {
                return {
                    peer: cleanUrl,
                    ok: false,
                    fetched,
                    applied,
                    error: {
                        code: err.code || 'INTERNAL_ERROR',
                        message: err.message,
                        details: err.details || {}
                    }
                };
            }
        }
    }

    return {
        peer: cleanUrl,
        ok: true,
        fetched,
        applied
    };
}

/**
 * Синхронизация со всеми соседями или с указанным peerUrl.
 */
async function syncPeers(blockchain, targetPeerUrl = null) {
    const peersToSync = targetPeerUrl ? [targetPeerUrl] : config.PEERS;
    const results = [];
    for (const peerUrl of peersToSync) {
        const result = await syncWithPeer(blockchain, peerUrl);
        results.push(result);
    }
    return {
        results,
        chainLength: blockchain.getChainLength()
    };
}

/**
 * Опрос статуса соседей для публичного эндпоинта GET /api/status (UI).
 */
async function getNetworkStatus(blockchain) {
    const localGenesisHash = blockchain.chain[0]?.hash || null;
    const latest = blockchain.getLatestBlock();

    const peersStatus = await Promise.all(
        (config.PEERS || []).map(async (peerUrl) => {
            try {
                const res = await fetchPeer(`${peerUrl}/api/node/info`, { method: 'GET' }, 2000);
                if (!res.ok) {
                    return { url: peerUrl, online: false };
                }
                const info = await res.json();
                return {
                    url: peerUrl,
                    online: true,
                    chainLength: info.chainLength,
                    networkMatch: info.networkId === localGenesisHash
                };
            } catch (_) {
                return { url: peerUrl, online: false };
            }
        })
    );

    return {
        nodeId: config.NODE_ID,
        chainLength: blockchain.getChainLength(),
        latestBlock: latest ? { index: latest.index, hash: latest.hash } : null,
        peers: peersStatus
    };
}

module.exports = {
    broadcastBlock,
    syncPeers,
    getNetworkStatus
};