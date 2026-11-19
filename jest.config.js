module.exports = {
    testEnvironment: 'node',
    moduleDirectories: ['node_modules', '<rootDir>/server/node_modules'],
    moduleNameMapper: {
        '^jsonwebtoken$': '<rootDir>/node_modules/jsonwebtoken'
    },
    collectCoverageFrom: [
        'blockchain/blockchain.js',
        'server/**/*.js',
        '!server/server.js',
        '!server/db.js',
        '!server/node_modules/**'
    ]
};