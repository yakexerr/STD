'use strict';

const path = require('path');
require('dotenv').config();

/**
 * Конфигурация сервера.
 * Значения берутся из переменных окружения или используются дефолтные.
 */
module.exports = {
    PORT: process.env.PORT || 5000,
    DB_HOST: process.env.DB_HOST || 'localhost',
    DB_USER: process.env.DB_USER || 'root',
    DB_PASSWORD: process.env.DB_PASSWORD || 'password',
    DB_NAME: process.env.DB_NAME || 'std_db',
    JWT_SECRET: process.env.JWT_SECRET || 'super-secret-key-change-in-production',
    JWT_EXPIRES_IN: '24h',
    UPLOADS_DIR: path.join(__dirname, 'uploads')
};