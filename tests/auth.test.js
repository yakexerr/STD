'use strict';

const { authenticateToken } = require('../server/middleware/auth');
const { optionalAuth } = require('../server/middleware/optionalAuth');
const jwt = require('jsonwebtoken');
const config = require('../server/config');

jest.mock('jsonwebtoken');
jest.mock('../server/config', () => ({ JWT_SECRET: 'test-secret' }));

describe('Auth Middleware Suite', () => {
    
    describe('authenticateToken', () => {
        it('должен записать данные пользователя в req.user и вызвать next(), если токен валидный', () => {
            const req = { headers: { authorization: 'Bearer valid-jwt-token' } };
            const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
            const next = jest.fn();
            const mockUser = { id: 123, email: 'user@test.com', role: 'HOLDER' };

            jwt.verify.mockReturnValue(mockUser);

            authenticateToken(req, res, next);

            expect(jwt.verify).toHaveBeenCalledWith('valid-jwt-token', config.JWT_SECRET);
            expect(req.user).toEqual(mockUser);
            expect(next).toHaveBeenCalledTimes(1);
            expect(res.status).not.toHaveBeenCalled();
        });

        it('должен вернуть 401, если заголовок authorization отсутствует', () => {
            const req = { headers: {} };
            const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
            const next = jest.fn();

            authenticateToken(req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith({ error: 'Access token required' });
            expect(next).not.toHaveBeenCalled();
        });

        it('должен вернуть 401, если jwt.verify выбрасывает ошибку (невалидный/просроченный токен)', () => {
            const req = { headers: { authorization: 'Bearer broken-token' } };
            const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
            const next = jest.fn();

            jwt.verify.mockImplementation(() => {
                throw new Error('Token expired');
            });

            authenticateToken(req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired token' });
            expect(next).not.toHaveBeenCalled();
        });
    });

    describe('optionalAuth', () => {
        it('должен записать пользователя в req.user и вызвать next(), если токен передан и валиден', () => {
            const req = { headers: { authorization: 'Bearer valid-token' } };
            const res = {}; 
            const next = jest.fn();
            const mockUser = { id: 777, email: 'guest@test.com', role: 'HOLDER' };

            jwt.verify.mockReturnValue(mockUser);

            optionalAuth(req, res, next);

            expect(jwt.verify).toHaveBeenCalledWith('valid-token', config.JWT_SECRET);
            expect(req.user).toEqual(mockUser);
            expect(next).toHaveBeenCalledTimes(1);
        });

        it('должен пропустить запрос без ошибки (вызвать next() без req.user), если токен отсутствует', () => {
            const req = { headers: {} };
            const res = {};
            const next = jest.fn();

            optionalAuth(req, res, next);

            expect(req.user).toBeUndefined();
            expect(next).toHaveBeenCalledTimes(1);
        });
    });

});