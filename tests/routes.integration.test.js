'use strict';

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const config = require('../server/config');
const pool = require('../server/db');
const documentService = require('../server/services/documentService');
const validationService = require('../server/services/validationService');

const authRoutes = require('../server/routes/auth');
const documentsRoutes = require('../server/routes/documents');
const validationRoutes = require('../server/routes/validation');

jest.mock('../server/db', () => ({
    query: jest.fn(),
    getConnection: jest.fn()
}));
jest.mock('bcryptjs');
jest.mock('../server/services/documentService');
jest.mock('../server/services/validationService');

function createTestApp(mockBlockchain = {}) {
    const app = express();
    app.use(express.json());
    app.set('blockchain', mockBlockchain);
    app.use('/api/auth', authRoutes);
    app.use('/api/documents', documentsRoutes);
    app.use('/api/validation', validationRoutes);
    return app;
}

describe('API Routes Integration Suite', () => {
    let app;
    let issuerToken;
    let holderToken;

    beforeEach(() => {
        jest.clearAllMocks();
        app = createTestApp({ checkDocument: jest.fn() });
        issuerToken = jwt.sign({ id: 1, email: 'uni@test.ru', role: 'ISSUER' }, config.JWT_SECRET);
        holderToken = jwt.sign({ id: 2, email: 'student@test.ru', role: 'HOLDER' }, config.JWT_SECRET);
    });

    it('POST /api/auth/register — 201 при валидных данных и 400 при ошибках валидации/дубле', async () => {
        pool.query.mockResolvedValueOnce([[]]).mockResolvedValueOnce([{ insertId: 10 }]);
        bcrypt.hash.mockResolvedValueOnce('hashed-pw');

        const ok = await request(app)
            .post('/api/auth/register')
            .send({ email: 'new@test.ru', password: 'secret123', role: 'HOLDER' });
        expect(ok.status).toBe(201);
        expect(ok.body.user).toEqual({ id: 10, email: 'new@test.ru', role: 'HOLDER' });

        expect((await request(app).post('/api/auth/register').send({})).status).toBe(400);
        expect((await request(app).post('/api/auth/register').send({ email: 'bad', password: 'secret123', role: 'HOLDER' })).status).toBe(400);
        expect((await request(app).post('/api/auth/register').send({ email: 'a@b.ru', password: '123', role: 'HOLDER' })).status).toBe(400);
        expect((await request(app).post('/api/auth/register').send({ email: 'a@b.ru', password: 'secret123', role: 'ADMIN' })).status).toBe(400);

        pool.query.mockResolvedValueOnce([[{ id: 1 }]]);
        const dup = await request(app)
            .post('/api/auth/register')
            .send({ email: 'exists@test.ru', password: 'secret123', role: 'ISSUER' });
        expect(dup.status).toBe(400);
    });

    it('POST /api/auth/login — 200 при верных данных, 400 без полей, 401 при неверных данных', async () => {
        expect((await request(app).post('/api/auth/login').send({})).status).toBe(400);

        pool.query.mockResolvedValueOnce([[]]);
        expect((await request(app).post('/api/auth/login').send({ email: 'none@test.ru', password: '123' })).status).toBe(401);

        pool.query.mockResolvedValueOnce([[{ id: 5, email: 'uni@test.ru', password_hash: 'hash', role: 'ISSUER' }]]);
        bcrypt.compare.mockResolvedValueOnce(false);
        expect((await request(app).post('/api/auth/login').send({ email: 'uni@test.ru', password: 'wrong' })).status).toBe(401);

        pool.query.mockResolvedValueOnce([[{ id: 5, email: 'uni@test.ru', password_hash: 'hash', role: 'ISSUER' }]]);
        bcrypt.compare.mockResolvedValueOnce(true);
        const ok = await request(app).post('/api/auth/login').send({ email: 'uni@test.ru', password: 'secret' });
        expect(ok.status).toBe(200);
        expect(ok.body.token).toBeTruthy();
    });

    it('POST /api/documents/issue, /revoke и GET /my', async () => {
        documentService.issueDocument.mockResolvedValueOnce({ documentId: 77, message: 'Document issued successfully' });
        const issued = await request(app)
            .post('/api/documents/issue')
            .set('Authorization', `Bearer ${issuerToken}`)
            .field('type', 'DIPLOMA')
            .field('holderEmail', 'student@test.ru')
            .attach('document', Buffer.from('%PDF-1.4'), { filename: 'diploma.pdf', contentType: 'application/pdf' });
        expect(issued.status).toBe(201);

        documentService.issueDocument.mockRejectedValueOnce(new Error('Holder not found'));
        const notFoundHolder = await request(app)
            .post('/api/documents/issue')
            .set('Authorization', `Bearer ${issuerToken}`)
            .field('type', 'DIPLOMA')
            .field('holderEmail', 'missing@test.ru')
            .attach('document', Buffer.from('%PDF-1.4'), { filename: 'diploma.pdf', contentType: 'application/pdf' });
        expect(notFoundHolder.status).toBe(400);

        documentService.revokeDocument.mockResolvedValueOnce({ message: 'Document revoked successfully' });
        const revoked = await request(app)
            .post('/api/documents/revoke')
            .set('Authorization', `Bearer ${issuerToken}`)
            .send({ documentId: 77 });
        expect(revoked.status).toBe(200);

        documentService.getMyDocuments.mockResolvedValueOnce([{ id: 77 }]);
        const my = await request(app)
            .get('/api/documents/my')
            .set('Authorization', `Bearer ${holderToken}`);
        expect(my.status).toBe(200);
        expect(my.body.documents).toEqual([{ id: 77 }]);
    });

    it('POST /api/validation/check (400 без файла, 200 с файлом) и GET /history', async () => {
        expect((await request(app).post('/api/validation/check')).status).toBe(400);

        validationService.checkDocument.mockResolvedValueOnce({ isValid: true, status: 'VALID', message: 'Document is authentic' });
        const check = await request(app)
            .post('/api/validation/check')
            .attach('document', Buffer.from('%PDF-1.4'), { filename: 'diploma.pdf', contentType: 'application/pdf' });
        expect(check.status).toBe(200);

        validationService.getVerificationHistory.mockResolvedValueOnce([{ id: 1, result: 'VALID' }]);
        const hist = await request(app)
            .get('/api/validation/history')
            .set('Authorization', `Bearer ${holderToken}`);
        expect(hist.status).toBe(200);
        expect(hist.body.requests).toEqual([{ id: 1, result: 'VALID' }]);
    });
});