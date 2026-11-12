'use strict';

const path = require('path');
require('dotenv').config();

const port = process.env.PORT || 5000;
const rawPeers = process.env.PEERS || '';
const peers = rawPeers
    .split(',')
    .map(p => p.trim().replace(/\/+$/, ''))
    .filter(Boolean);

/**
 * Конфигурация сервера и P2P-ноды.
 * Значения берутся из переменных окружения или используются дефолтные.
 */
module.exports = {
    PORT: port,
    NODE_ID: process.env.NODE_ID || `node-${port}`,
    BLOCKCHAIN_FILE: process.env.BLOCKCHAIN_FILE || 'blockchain/blockchain.json',
    PEERS: peers,
    NETWORK_TOKEN: process.env.NETWORK_TOKEN || '',
    P2P_TIMEOUT_MS: parseInt(process.env.P2P_TIMEOUT_MS, 10) || 5000,
    DB_HOST: process.env.DB_HOST || 'localhost',
    DB_USER: process.env.DB_USER || 'root',
    DB_PASSWORD: process.env.DB_PASSWORD || 'root',
    DB_NAME: process.env.DB_NAME || 'std_db',
    JWT_SECRET: process.env.JWT_SECRET || 'super-secret-key-change-in-production',
    JWT_EXPIRES_IN: '24h',
    UPLOADS_DIR: path.join(__dirname, 'uploads')
};