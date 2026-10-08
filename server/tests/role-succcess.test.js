'use strict';

const { requireRole } = require('../middleware/auth');

describe('requireRole - Success', () => {
    it('должен пропустить пользователя ISSUER, если запрашивается роль ISSUER', () => {
        const req = { user: { id: 1, role: 'ISSUER' } };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        const next = jest.fn();

        const middleware = requireRole('ISSUER');
        middleware(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
    });
});