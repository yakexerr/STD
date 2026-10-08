'use strict';

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const { Blockchain } = require('../blockchain/blockchain');

const authRoutes = require('./routes/auth');
const documentsRoutes = require('./routes/documents');
const validationRoutes = require('./routes/validation');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Создаем директорию для загрузок, если она не существует
if (!fs.existsSync(config.UPLOADS_DIR)) {
    fs.mkdirSync(config.UPLOADS_DIR, { recursive: true });
}

// Инициализируем блокчейн и сохраняем в app для доступа из роутов
const blockchain = new Blockchain();
app.set('blockchain', blockchain);

// Подключаем роуты
app.use('/api/auth', authRoutes);
app.use('/api/documents', documentsRoutes);
app.use('/api/validation', validationRoutes);

// Запуск сервера
app.listen(config.PORT, () => {
    console.log(`Server is running on port ${config.PORT}`);
});

// Экспортируем app для тестирования
module.exports = app;