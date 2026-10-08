'use strict';

const { authenticateToken } = require('../middleware/auth');
const jwt = require('jsonwebtoken');
const config = require('../config'); 

jest.mock('jsonwebtoken');
jest.mock('../config', () => ({ JWT_SECRET: 'test-secret' }));

describe('authenticateToken - Success', () => {
    it('должен записать данные пользователя в req.user и вызвать next()', () => {
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
});
