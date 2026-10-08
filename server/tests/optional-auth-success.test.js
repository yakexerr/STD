'use strict';

const { optionalAuth } = require('../middleware/optionalAuth');
const jwt = require('jsonwebtoken');
const config = require('../config');

jest.mock('jsonwebtoken');
jest.mock('../config', () => ({ JWT_SECRET: 'test-secret' }));

describe('optionalAuth - Success', () => {
    it('должен записать пользователя в req.user и вызвать next(), если токен валидный', () => {
        const req = { headers: { authorization: 'Bearer valid-token' } };
        const res = {}; // res не используется при успехе
        const next = jest.fn();
        const mockUser = { id: 777, email: 'guest@test.com', role: 'HOLDER' };

        jwt.verify.mockReturnValue(mockUser);

        optionalAuth(req, res, next);

        expect(jwt.verify).toHaveBeenCalledWith('valid-token', config.JWT_SECRET);
        expect(req.user).toEqual(mockUser);
        expect(next).toHaveBeenCalledTimes(1);
    });
});
