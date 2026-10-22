'use strict';

const { requireRole } = require('../server/middleware/auth');

describe('Role-based Access Control (requireRole) Suite', () => {
    
    it('должен успешно пропустить пользователя, если его роль совпадает с требуемой', () => {
        const req = { user: { id: 1, role: 'ISSUER' } };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        const next = jest.fn();

        const middleware = requireRole('ISSUER');
        middleware(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
    });

    it('должен вернуть 403, если у пользователя недостаточно прав (например, HOLDER пытается зайти под ISSUER)', () => {
        const req = { user: { id: 2, role: 'HOLDER' } };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        const next = jest.fn();

        const middleware = requireRole('ISSUER');
        middleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({ error: 'Insufficient permissions' });
        expect(next).not.toHaveBeenCalled();
    });

    it('должен вернуть 401, если пользователь вообще не аутентифицирован (нет req.user)', () => {
        const req = {}; // req.user отсутствует
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        const next = jest.fn();

        const middleware = requireRole('ISSUER');
        middleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required' });
        expect(next).not.toHaveBeenCalled();
    });

});