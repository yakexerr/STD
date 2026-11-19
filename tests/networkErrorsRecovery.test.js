'use strict';

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const os = require('os');

const config = require('../server/config');
const pool = require('../server/db');
const { Blockchain } = require('../blockchain');
const { optionalAuth } = require('../server/middleware/optionalAuth');
const documentService = require('../server/services/documentService');
const validationService = require('../server/services/validationService');
const { calculateFileHash } = require('../server/utils/fileUtils');

const authRoutes = require('../server/routes/auth');
const documentsRoutes = require('../server/routes/documents');
const validationRoutes = require('../server/routes/validation');

jest.mock('../server/db', () => ({
    query: jest.fn(),
    getConnection: jest.fn()
}));

function buildApp(blockchain) {
    const app = express();
    app.use(express.json());
    app.set('blockchain', blockchain);
    app.use('/api/auth', authRoutes);
    app.use('/api/documents', documentsRoutes);
    app.use('/api/validation', validationRoutes);
    app.use((err, req, res, next) => {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ error: 'File too large' });
        }
        return res.status(400).json({ error: err.message });
    });
    return app;
}

describe('Тестировщик: сетевые сценарии, ошибки и восстановление', () => {
    let issuerToken;
    let holderToken;

    beforeEach(() => {
        jest.clearAllMocks();
        issuerToken = jwt.sign({ id: 1, email: 'uni@test.ru', role: 'ISSUER' }, config.JWT_SECRET);
        holderToken = jwt.sign({ id: 2, email: 'student@test.ru', role: 'HOLDER' }, config.JWT_SECRET);
    });

    describe('1. Сетевые ошибки и падение/деградация БД', () => {
        it('POST /api/auth/register и /login возвращают 500 при обрыве связи с БД (ECONNREFUSED)', async () => {
            const app = buildApp({});
            pool.query.mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }));

            const regRes = await request(app)
                .post('/api/auth/register')
                .send({ email: 'a@test.ru', password: 'password123', role: 'HOLDER' });
            expect(regRes.status).toBe(500);
            expect(regRes.body).toEqual({ error: 'Internal server error' });

            const loginRes = await request(app)
                .post('/api/auth/login')
                .send({ email: 'a@test.ru', password: 'password123' });
            expect(loginRes.status).toBe(500);
            expect(loginRes.body).toEqual({ error: 'Internal server error' });
        });

        it('GET /api/documents/my и GET /api/validation/history возвращают 500 при сетевом таймауте БД', async () => {
            const app = buildApp({});
            pool.query.mockRejectedValue(new Error('ETIMEDOUT'));

            const docsRes = await request(app)
                .get('/api/documents/my')
                .set('Authorization', `Bearer ${holderToken}`);
            expect(docsRes.status).toBe(500);

            const histRes = await request(app)
                .get('/api/validation/history')
                .set('Authorization', `Bearer ${holderToken}`);
            expect(histRes.status).toBe(500);
        });

        it('optionalAuth при битом Bearer-токене не роняет запрос (graceful fallback в анонимный режим)', () => {
            const req = { headers: { authorization: 'Bearer forged.jwt.token' } };
            const res = {};
            const next = jest.fn();

            optionalAuth(req, res, next);

            expect(req.user).toBeUndefined();
            expect(next).toHaveBeenCalledTimes(1);
        });

        it('POST /api/validation/check продолжает работать (200 VALID), даже если запись истории в БД упала', async () => {
            const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
            const mockBlockchain = {
                checkDocument: jest.fn().mockReturnValue({ isValid: true, status: 'VALID' })
            };
            const app = buildApp(mockBlockchain);
            pool.query.mockRejectedValueOnce(new Error('MySQL server has gone away'));

            const res = await request(app)
                .post('/api/validation/check')
                .set('Authorization', `Bearer ${holderToken}`)
                .attach('document', Buffer.from('%PDF-1.4 valid'), {
                    filename: 'diploma.pdf',
                    contentType: 'application/pdf'
                });

            expect(res.status).toBe(200);
            expect(res.body).toEqual({
                isValid: true,
                status: 'VALID',
                message: 'Document is authentic'
            });
            consoleSpy.mockRestore();
        });
    });

    describe('2. Сетевые ошибки загрузки файлов (multer) и HTTP-валидации', () => {
        it('POST /api/documents/issue отклоняет не-PDF файл и не обращается к БД/блокчейну', async () => {
            const app = buildApp({ issueDocument: jest.fn() });

            const res = await request(app)
                .post('/api/documents/issue')
                .set('Authorization', `Bearer ${issuerToken}`)
                .field('type', 'DIPLOMA')
                .field('holderEmail', 'student@test.ru')
                .attach('document', Buffer.from('not a pdf'), {
                    filename: 'malware.txt',
                    contentType: 'text/plain'
                });

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Only PDF files are allowed');
            expect(pool.query).not.toHaveBeenCalled();
        });

        it('POST /api/documents/issue проверяет права (401/403), наличие файла и обязательных полей (400)', async () => {
            const app = buildApp({});

            const noToken = await request(app).post('/api/documents/issue');
            expect(noToken.status).toBe(401);

            const wrongRole = await request(app)
                .post('/api/documents/issue')
                .set('Authorization', `Bearer ${holderToken}`);
            expect(wrongRole.status).toBe(403);

            const noFile = await request(app)
                .post('/api/documents/issue')
                .set('Authorization', `Bearer ${issuerToken}`)
                .field('type', 'DIPLOMA')
                .field('holderEmail', 'student@test.ru');
            expect(noFile.status).toBe(400);
            expect(noFile.body.error).toBe('Document file is required');

            const badType = await request(app)
                .post('/api/documents/issue')
                .set('Authorization', `Bearer ${issuerToken}`)
                .field('type', 'INVALID')
                .field('holderEmail', 'student@test.ru')
                .attach('document', Buffer.from('%PDF-1.4'), { filename: 'd.pdf', contentType: 'application/pdf' });
            expect(badType.status).toBe(400);

            const noEmail = await request(app)
                .post('/api/documents/issue')
                .set('Authorization', `Bearer ${issuerToken}`)
                .field('type', 'DIPLOMA')
                .attach('document', Buffer.from('%PDF-1.4'), { filename: 'd.pdf', contentType: 'application/pdf' });
            expect(noEmail.status).toBe(400);
        });

        it('POST /api/documents/revoke проверяет documentId (400) и доступ к несуществующему документу', async () => {
            const app = buildApp({});

            const noId = await request(app)
                .post('/api/documents/revoke')
                .set('Authorization', `Bearer ${issuerToken}`)
                .send({});
            expect(noId.status).toBe(400);

            const mockConn = {
                beginTransaction: jest.fn().mockResolvedValue(),
                query: jest.fn().mockResolvedValueOnce([[]]),
                commit: jest.fn(),
                rollback: jest.fn().mockResolvedValue(),
                release: jest.fn()
            };
            pool.getConnection.mockResolvedValueOnce(mockConn);

            const notFound = await request(app)
                .post('/api/documents/revoke')
                .set('Authorization', `Bearer ${issuerToken}`)
                .send({ documentId: 999 });
            expect(notFound.status).toBe(403);
            expect(mockConn.rollback).toHaveBeenCalledTimes(1);
            expect(mockConn.release).toHaveBeenCalledTimes(1);
        });
    });

    describe('3. Восстановление после сбоев (Rollback БД, очистка диска, release)', () => {
        it('откатывает транзакцию, удаляет PDF с диска и освобождает connection при ошибке БД на INSERT', async () => {
            const writeSpy = jest.spyOn(fsPromises, 'writeFile').mockResolvedValue();
            const unlinkSpy = jest.spyOn(fsPromises, 'unlink').mockResolvedValue();

            const mockConn = {
                beginTransaction: jest.fn().mockResolvedValue(),
                query: jest.fn().mockRejectedValue(new Error('ER_LOCK_DEADLOCK')),
                commit: jest.fn(),
                rollback: jest.fn().mockResolvedValue(),
                release: jest.fn()
            };
            pool.query.mockResolvedValueOnce([[{ id: 42, role: 'HOLDER' }]]);
            pool.getConnection.mockResolvedValueOnce(mockConn);

            await expect(
                documentService.issueDocument({ issueDocument: jest.fn() }, 1, 'DIPLOMA', 'student@test.ru', {
                    buffer: Buffer.from('%PDF-1.4')
                })
            ).rejects.toThrow('ER_LOCK_DEADLOCK');

            expect(mockConn.rollback).toHaveBeenCalledTimes(1);
            expect(mockConn.commit).not.toHaveBeenCalled();
            expect(unlinkSpy).toHaveBeenCalledTimes(1);
            expect(mockConn.release).toHaveBeenCalledTimes(1);

            writeSpy.mockRestore();
            unlinkSpy.mockRestore();
        });

        it('откатывает транзакцию и удаляет файл при сбое блокчейна, даже если fs.unlink тоже падает', async () => {
            const writeSpy = jest.spyOn(fsPromises, 'writeFile').mockResolvedValue();
            const unlinkSpy = jest.spyOn(fsPromises, 'unlink').mockRejectedValue(new Error('ENOENT'));

            const mockConn = {
                beginTransaction: jest.fn().mockResolvedValue(),
                query: jest.fn().mockResolvedValue([{ insertId: 10 }]),
                commit: jest.fn(),
                rollback: jest.fn().mockResolvedValue(),
                release: jest.fn()
            };
            pool.query.mockResolvedValueOnce([[{ id: 42, role: 'HOLDER' }]]);
            pool.getConnection.mockResolvedValueOnce(mockConn);

            const brokenBlockchain = {
                issueDocument: jest.fn(() => {
                    throw new Error('Failed to save blockchain: ENOSPC');
                })
            };

            await expect(
                documentService.issueDocument(brokenBlockchain, 1, 'CERTIFICATE', 'student@test.ru', {
                    buffer: Buffer.from('%PDF-1.4')
                })
            ).rejects.toThrow('Failed to save blockchain: ENOSPC');

            expect(mockConn.rollback).toHaveBeenCalledTimes(1);
            expect(mockConn.release).toHaveBeenCalledTimes(1);

            writeSpy.mockRestore();
            unlinkSpy.mockRestore();
        });

        it('откатывает транзакцию при ошибке блокчейна во время отзыва документа', async () => {
            const mockConn = {
                beginTransaction: jest.fn().mockResolvedValue(),
                query: jest.fn()
                    .mockResolvedValueOnce([[{ id: 55, issuer_id: 1 }]])
                    .mockResolvedValueOnce([{}]),
                commit: jest.fn(),
                rollback: jest.fn().mockResolvedValue(),
                release: jest.fn()
            };
            pool.getConnection.mockResolvedValueOnce(mockConn);

            const bc = {
                revokeDocument: jest.fn(() => {
                    throw new Error('Document 55 already revoked');
                })
            };

            await expect(documentService.revokeDocument(bc, 1, 55)).rejects.toThrow('Document 55 already revoked');
            expect(mockConn.rollback).toHaveBeenCalledTimes(1);
            expect(mockConn.commit).not.toHaveBeenCalled();
            expect(mockConn.release).toHaveBeenCalledTimes(1);
        });
    });

    describe('4. Восстановление блокчейна и изоляция подмены на реальном диске', () => {
        let tmpDir;
        let chainFile;

        beforeEach(() => {
            tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'std-chain-test-'));
            chainFile = path.join(tmpDir, 'blockchain.json');
        });

        afterEach(() => {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });

        it('автоматически восстанавливает genesis-блок при отсутствии или обнулении blockchain.json', () => {
            const bc1 = new Blockchain(chainFile);
            expect(fs.existsSync(chainFile)).toBe(true);
            expect(bc1.getChainLength()).toBe(1);
            expect(bc1.isValid()).toBe(true);

            fs.writeFileSync(chainFile, '', 'utf8');
            const bc2 = new Blockchain(chainFile);
            expect(bc2.getChainLength()).toBe(1);
            expect(bc2.getLatestBlock().type).toBe('BEGIN');
        });

        it('сохраняет цепочку между перезапусками, детектирует подделку и возвращает детализированную ошибку 500 ERROR', async () => {
            const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

            const pdfBuffer = Buffer.from('%PDF-1.4 real-diploma');
            const docHash = calculateFileHash(pdfBuffer);

            const bc1 = new Blockchain(chainFile);
            bc1.issueDocument('doc-100', docHash, '1', '2');

            const bc2 = new Blockchain(chainFile);
            expect(bc2.getChainLength()).toBe(2);
            const app2 = buildApp(bc2);
            const okRes = await request(app2)
                .post('/api/validation/check')
                .attach('document', pdfBuffer, { filename: 'diploma.pdf', contentType: 'application/pdf' });
            expect(okRes.status).toBe(200);
            expect(okRes.body.status).toBe('VALID');

            const raw = JSON.parse(fs.readFileSync(chainFile, 'utf8'));
            raw[1].data.holderId = '999-attacker';
            fs.writeFileSync(chainFile, JSON.stringify(raw, null, 2), 'utf8');

            const bc3 = new Blockchain(chainFile);
            const app3 = buildApp(bc3);
            const tamperedRes = await request(app3)
                .post('/api/validation/check')
                .attach('document', pdfBuffer, { filename: 'diploma.pdf', contentType: 'application/pdf' });

            expect(tamperedRes.status).toBe(500);
            expect(tamperedRes.body.status).toBe('ERROR');
            expect(tamperedRes.body.error).toBe('Blockchain integrity check failed');
            expect(tamperedRes.body.details.blockIndex).toBe(1);

            consoleSpy.mockRestore();
        });
    });

    describe('5. Доп. проверка сервисов: getMyDocuments и getVerificationHistory', () => {
        it('getMyDocuments возвращает документы для HOLDER/ISSUER и [] для неизвестной роли', async () => {
            pool.query.mockResolvedValueOnce([[{ id: 1 }]]);
            expect(await documentService.getMyDocuments(2, 'HOLDER')).toEqual([{ id: 1 }]);

            pool.query.mockResolvedValueOnce([[{ id: 2 }]]);
            expect(await documentService.getMyDocuments(1, 'ISSUER')).toEqual([{ id: 2 }]);

            expect(await documentService.getMyDocuments(1, 'UNKNOWN')).toEqual([]);
        });

        it('validationService.checkDocument возвращает REVOKED и NOT_FOUND без записи в БД для гостя', async () => {
            const bc = {
                checkDocument: jest.fn()
                    .mockReturnValueOnce({ isValid: false, status: 'REVOKED' })
                    .mockReturnValueOnce({ isValid: false, status: 'NOT_FOUND' })
            };
            const file = { buffer: Buffer.from('abc') };

            expect(await validationService.checkDocument(bc, file, null)).toEqual({
                isValid: false,
                status: 'REVOKED',
                message: 'Document has been revoked'
            });
            expect(await validationService.checkDocument(bc, file, null)).toEqual({
                isValid: false,
                status: 'NOT_FOUND',
                message: 'Document not found in registry'
            });
            expect(pool.query).not.toHaveBeenCalled();
        });
    });
});