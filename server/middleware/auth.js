'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');

/**
 * Middleware для проверки JWT токена.
 * Читает токен из заголовка Authorization: Bearer <token>.
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @param {Function} next - Express next middleware function.
 */
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    try {
        const decoded = jwt.verify(token, config.JWT_SECRET);
        req.user = {
            id: decoded.id,
            email: decoded.email,
            role: decoded.role
        };
        next();
    } catch (error) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}

/**
 * Фабрика middleware для проверки роли пользователя.
 * @param {string} requiredRole - Требуемая роль ('ISSUER' или 'HOLDER').
 * @returns {Function} Middleware функция.
 */
function requireRole(requiredRole) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        if (req.user.role !== requiredRole) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }

        next();
    };
}

module.exports = { authenticateToken, requireRole };