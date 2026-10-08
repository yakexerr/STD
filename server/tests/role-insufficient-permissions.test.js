'use strict';

const { requireRole } = require('../middleware/auth');

describe('requireRole - Insufficient Permissions', () => {
    it('должен вернуть 403, если роль HOLDER пытается зайти под требуемой ролью ISSUER', () => {
        const req = { user: { id: 2, role: 'HOLDER' } };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        const next = jest.fn();

        const middleware = requireRole('ISSUER');
        middleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({ error: 'Insufficient permissions' });
        expect(next).not.toHaveBeenCalled();
    });
});
