'use strict';

const { authenticateToken } = require('../middleware/auth');

describe('authenticateToken - Missing Token', () => {
    it('должен вернуть 401 и ошибку, если заголовок authorization отсутствует', () => {
        const req = { headers: {} };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        const next = jest.fn();

        authenticateToken(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'Access token required' });
        expect(next).not.toHaveBeenCalled();
    });
});
