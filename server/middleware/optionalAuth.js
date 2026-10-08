'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');

/**
 * Middleware для опциональной аутентификации.
 * Если токен присутствует и валиден - устанавливает req.user.
 * Если токен отсутствует или невалиден - продолжает выполнение без авторизации.
 * Используется для эндпоинтов, которые могут работать как с авторизованными,
 * так и с анонимными пользователями.
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @param {Function} next - Express next middleware function.
 */
function optionalAuth(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    // Если токена нет - продолжаем без авторизации
    if (!token) {
        return next();
    }
    
    try {
        // Пытаемся верифицировать токен
        const decoded = jwt.verify(token, config.JWT_SECRET);
        req.user = {
            id: decoded.id,
            email: decoded.email,
            role: decoded.role
        };
        next();
    } catch (error) {
        // Токен невалидный - продолжаем без авторизации
        // Не возвращаем ошибку, так как авторизация опциональна
        next();
    }
}

module.exports = { optionalAuth };