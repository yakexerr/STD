'use strict';

const multer = require('multer');

/**
 * Конфигурация multer для загрузки PDF файлов.
 * Использует memory storage (файл хранится в буфере в памяти).
 * Ограничивает размер файла 10MB и разрешает только PDF.
 */
const storage = multer.memoryStorage();

const upload = multer({
    storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only PDF files are allowed'), false);
        }
    }
});

module.exports = upload;