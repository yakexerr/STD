'use strict';

const { authenticateToken } = require('../middleware/auth');
const jwt = require('jsonwebtoken');

jest.mock('jsonwebtoken');

describe('authenticateToken - Invalid Token', () => {
    it('должен вернуть 401, если jwt.verify выбрасывает ошибку', () => {
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
