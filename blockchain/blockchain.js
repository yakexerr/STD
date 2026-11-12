'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const HEX_64_REGEX = /^[0-9a-f]{64}$/;

/**
 * Создаёт структурированный объект ошибки ядра с кодом и деталями контракта.
 * @param {string} code - Машинный код ошибки.
 * @param {string} message - Человекочитаемое описание ошибки.
 * @param {Object} [details={}] - Дополнительные параметры ошибки.
 * @returns {Error}
 */
function createChainError(code, message, details = {}) {
    const err = new Error(message);
    err.code = code;
    err.details = details;
    return err;
}

/**
 * Рекурсивно сортирует ключи объекта по алфавиту на всех уровнях вложенности.
 * Гарантирует детерминированную сериализацию независимо от исходного порядка ключей.
 * @param {*} obj - Объект или значение для сортировки.
 * @returns {*} Новый объект с отсортированными ключами или исходное примитивное значение.
 */
function sortKeysDeep(obj) {
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }
    if (Array.isArray(obj)) {
        return obj.map(item => sortKeysDeep(item));
    }
    const sortedObj = {};
    Object.keys(obj).sort().forEach(key => {
        sortedObj[key] = sortKeysDeep(obj[key]);
    });
    return sortedObj;
}

/**
 * Детерминированная сериализация объекта в JSON-строку с отсортированными ключами.
 * @param {*} obj - Объект для сериализации.
 * @returns {string} JSON-строка с отсортированными ключами.
 */
function deterministicStringify(obj) {
    return JSON.stringify(sortKeysDeep(obj));
}

/**
 * Класс, представляющий отдельный блок в цепочке блокчейна.
 * Хранит индекс, временную метку, тип блока, пользовательские данные
 * и криптографические хэши для обеспечения целостности.
 */
class Block {
    /**
     * Создает экземпляр блока.
     * При создании нового блока хэш вычисляется автоматически.
     * При загрузке из файла или получении из сети используется оригинальный хэш для валидации целостности.
     * @param {number} index - Порядковый индекс блока в цепочке.
     * @param {string} timestamp - Временная метка создания блока в формате ISO 8601.
     * @param {string} type - Тип блока: "BEGIN", "ISSUE" или "REVOKE".
     * @param {Object} data - Пользовательские данные блока.
     * @param {string} previousHash - SHA-256 хэш предыдущего блока.
     * @param {string|null} [hash=null] - Оригинальный хэш блока или null (при создании).
     */
    constructor(index, timestamp, type, data, previousHash, hash = null) {
        this.index = index;
        this.timestamp = timestamp;
        this.type = type;
        this.data = data;
        this.previousHash = previousHash;
        this.hash = hash !== null ? hash : this.calculateHash();
    }

    /**
     * Вычисляет SHA-256 хэш блока на основе его содержимого.
     * Строка для хэширования формируется путем конкатенации всех полей блока.
     * @returns {string} Hex-строка SHA-256 хэша длиной 64 символа.
     */
    calculateHash() {
        const payload = String(this.index)
            + this.timestamp
            + this.type
            + deterministicStringify(this.data)
            + this.previousHash;
        return crypto.createHash('sha256').update(payload).digest('hex');
    }

    /**
     * Сериализует блок в объект для записи в JSON.
     * Гарантирует, что все поля блока будут корректно записаны при сохранении в файл.
     * @returns {Object} Объект со всеми полями блока.
     */
    toJSON() {
        return {
            index: this.index,
            timestamp: this.timestamp,
            type: this.type,
            data: this.data,
            previousHash: this.previousHash,
            hash: this.hash
        };
    }
}

/**
 * Класс, реализующий логику цепочки блоков.
 * Управляет хранением цепочки в JSON-файле, валидацией целостности,
 * операциями выпуска/отзыва документов и приёмом блоков от других нод.
 */
class Blockchain {
    /**
     * Инициализирует блокчейн, загружая данные из файла или создавая genesis-блок.
     * @param {string} [filePath] - Путь к файлу хранения цепочки. По умолчанию blockchain.json в текущей директории.
     */
    constructor(filePath) {
        /** @type {string} */
        this.filePath = filePath || path.join(__dirname, 'blockchain.json');
        /** @type {Block[]} */
        this.chain = [];
        this.load();
    }

    /**
     * Загружает цепочку блоков из файла.
     * Если файл отсутствует или пуст — инициализирует genesis-блок.
     * При загрузке существующего файла восстанавливает блоки с оригинальными хэшами
     * и проверяет криптографическую целостность всей цепочки.
     * @throws {Error} Если файл повреждён (не является массивом).
     * @throws {Error} Если целостность загруженной цепочки нарушена (обнаружена подделка).
     * @throws {Error} Если произошла ошибка чтения или парсинга файла.
     */
    load() {
        try {
            if (!fs.existsSync(this.filePath)) {
                this.createGenesisBlock();
                this.save();
                return;
            }

            const fileContent = fs.readFileSync(this.filePath, 'utf8').trim();
            if (fileContent === '') {
                this.createGenesisBlock();
                this.save();
                return;
            }

            const parsedChain = JSON.parse(fileContent);

            if (!Array.isArray(parsedChain)) {
                throw new Error('Blockchain file is corrupted: expected an array');
            }

            this.chain = parsedChain.map(blockData =>
                new Block(
                    blockData.index,
                    blockData.timestamp,
                    blockData.type,
                    blockData.data,
                    blockData.previousHash,
                    blockData.hash
                )
            );

            const integrity = this.validateChain();
            if (!integrity.valid) {
                throw new Error(`Blockchain integrity check failed on load: ${integrity.error.reason}`);
            }
        } catch (error) {
            if (error.message.startsWith('Blockchain integrity check failed on load') ||
                error.message === 'Blockchain file is corrupted: expected an array') {
                throw error;
            }
            throw new Error(`Failed to load blockchain: ${error.message}`);
        }
    }

    /**
     * Сохраняет текущее состояние цепочки в файл.
     * Использует форматирование с отступами для читаемости JSON.
     * @throws {Error} Если произошла ошибка записи в файл.
     */
    save() {
        try {
            const dir = path.dirname(this.filePath);
            if (dir && dir !== '.' && !fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.filePath, JSON.stringify(this.chain, null, 2), 'utf8');
        } catch (error) {
            throw new Error(`Failed to save blockchain: ${error.message}`);
        }
    }

    /**
     * Создает и добавляет genesis-блок (начальный блок цепочки с индексом 0).
     */
    createGenesisBlock() {
        const genesis = new Block(0, '2026-01-01T00:00:00.000Z', 'BEGIN', {}, '0');
        this.chain = [genesis];
        this.save();
    }

    /**
     * Возвращает последний (самый новый) блок в цепочке.
     * @returns {Block} Последний блок цепочки.
     */
    getLatestBlock() {
        return this.chain[this.chain.length - 1];
    }

    /**
     * Приватный метод. Создает новый блок указанного типа, добавляет его в цепочку
     * и автоматически сохраняет изменения на диск.
     * @param {string} type - Тип создаваемого блока ("ISSUE" или "REVOKE").
     * @param {Object} data - Данные для нового блока.
     * @returns {Block} Созданный и добавленный блок.
     * @throws {TypeError} Если передан некорректный тип блока.
     */
    #addBlock(type, data) {
        const VALID_TYPES = ['ISSUE', 'REVOKE'];
        if (!VALID_TYPES.includes(type)) {
            throw new TypeError(`Invalid block type: ${type}. Must be one of: ${VALID_TYPES.join(', ')}`);
        }

        const latest = this.getLatestBlock();
        const newBlock = new Block(
            latest.index + 1,
            new Date().toISOString(),
            type,
            data,
            latest.hash
        );
        this.chain.push(newBlock);
        this.save();
        return newBlock;
    }

    /**
     * Регистрирует выпуск нового документа, создавая блок типа ISSUE.
     * Проверяет целостность цепочки и уникальность documentId и documentHash.
     * @param {string} documentId - Уникальный идентификатор документа.
     * @param {string} documentHash - SHA-256 хэш содержимого документа.
     * @param {string} issuerId - Идентификатор эмитента (ВУЗа).
     * @param {string} holderId - Идентификатор владельца документа.
     * @returns {Block} Созданный блок типа ISSUE.
     */
    issueDocument(documentId, documentHash, issuerId, holderId) {
        const integrity = this.validateChain();
        if (!integrity.valid) {
            throw createChainError(
                'BLOCKCHAIN_TAMPERED',
                `Blockchain integrity check failed: ${integrity.error.reason}`,
                integrity.error
            );
        }

        if (typeof documentId !== 'string' || documentId.trim() === '') {
            throw new TypeError('documentId must be a non-empty string');
        }
        if (typeof documentHash !== 'string' || documentHash.trim() === '') {
            throw new TypeError('documentHash must be a non-empty string');
        }
        if (typeof issuerId !== 'string' || issuerId.trim() === '') {
            throw new TypeError('issuerId must be a non-empty string');
        }
        if (typeof holderId !== 'string' || holderId.trim() === '') {
            throw new TypeError('holderId must be a non-empty string');
        }

        for (const block of this.chain) {
            if (block.type === 'ISSUE') {
                if (block.data.documentId === documentId) {
                    throw new Error(`Document already exists with ID: ${documentId}`);
                }
                if (block.data.documentHash === documentHash) {
                    throw new Error(`Document already exists with hash: ${documentHash}`);
                }
            }
        }

        return this.#addBlock("ISSUE", { documentId, documentHash, issuerId, holderId });
    }

    /**
     * Отзывает ранее выпущенный документ, создавая блок типа REVOKE.
     * Проверяет целостность цепочки, наличие ISSUE и отсутствие повторного REVOKE.
     * @param {string} documentId - Идентификатор отзываемого документа.
     * @returns {Block} Созданный блок типа REVOKE.
     */
    revokeDocument(documentId) {
        const integrity = this.validateChain();
        if (!integrity.valid) {
            throw createChainError(
                'BLOCKCHAIN_TAMPERED',
                `Blockchain integrity check failed: ${integrity.error.reason}`,
                integrity.error
            );
        }

        if (typeof documentId !== 'string' || documentId.trim() === '') {
            throw new TypeError('documentId must be a non-empty string');
        }

        let foundIssue = false;
        let foundRevoke = false;

        for (const block of this.chain) {
            if (block.type === 'ISSUE' && block.data.documentId === documentId) {
                foundIssue = true;
            }
            if (block.type === 'REVOKE' && block.data.documentId === documentId) {
                foundRevoke = true;
            }
        }

        if (!foundIssue) {
            throw new Error(`Document ${documentId} not found`);
        }
        if (foundRevoke) {
            throw new Error(`Document ${documentId} already revoked`);
        }

        return this.#addBlock("REVOKE", { documentId });
    }

    /**
     * Проверяет статус документа по его хэшу.
     * Сканирует всю цепочку для поиска ISSUE и потенциального REVOKE блоков.
     * @param {string} documentHash - SHA-256 хэш проверяемого документа.
     * @returns {Object} Объект результата: { isValid: boolean, status: "VALID" | "REVOKED" | "NOT_FOUND" }.
     */
    checkDocument(documentHash) {
        if (typeof documentHash !== 'string' || documentHash.trim() === '') {
            throw new TypeError('documentHash must be a non-empty string');
        }

        const integrity = this.validateChain();
        if (!integrity.valid) {
            throw createChainError(
                'BLOCKCHAIN_TAMPERED',
                `Blockchain integrity check failed: ${integrity.error.reason}`,
                integrity.error
            );
        }

        let issueBlock = null;
        for (const block of this.chain) {
            if (block.type === 'ISSUE' && block.data.documentHash === documentHash) {
                issueBlock = block;
                break;
            }
        }

        if (!issueBlock) {
            return { isValid: false, status: "NOT_FOUND" };
        }

        const documentId = issueBlock.data.documentId;
        for (const block of this.chain) {
            if (block.type === 'REVOKE' && block.data.documentId === documentId) {
                return { isValid: false, status: "REVOKED" };
            }
        }

        return { isValid: true, status: "VALID" };
    }

    /**
     * Проверяет криптографическую целостность всей цепочки блоков.
     * Валидирует genesis-блок, последовательность индексов, связь хэшей
     * и корректность вычисленных хэшей каждого блока.
     * @returns {{ valid: boolean, error: Object|null }}
     */
    validateChain() {
        if (this.chain.length === 0) {
            return {
                valid: false,
                error: { blockIndex: -1, blockHash: null, reason: 'Blockchain is empty' }
            };
        }

        const genesis = this.chain[0];
        if (genesis.index !== 0) {
            return {
                valid: false,
                error: { blockIndex: genesis.index, blockHash: genesis.hash, reason: `Genesis block has invalid index (expected 0, got ${genesis.index})` }
            };
        }
        if (genesis.previousHash !== "0") {
            return {
                valid: false,
                error: { blockIndex: genesis.index, blockHash: genesis.hash, reason: `Genesis block has invalid previousHash (expected "0", got "${genesis.previousHash}")` }
            };
        }
        if (genesis.type !== "BEGIN") {
            return {
                valid: false,
                error: { blockIndex: genesis.index, blockHash: genesis.hash, reason: `Genesis block has invalid type (expected "BEGIN", got "${genesis.type}")` }
            };
        }
        if (genesis.hash !== genesis.calculateHash()) {
            return {
                valid: false,
                error: { blockIndex: genesis.index, blockHash: genesis.hash, reason: 'Genesis block hash mismatch: data has been tampered with' }
            };
        }

        for (let i = 1; i < this.chain.length; i++) {
            const current = this.chain[i];
            const previous = this.chain[i - 1];

            if (current.previousHash !== previous.hash) {
                return {
                    valid: false,
                    error: {
                        blockIndex: current.index,
                        blockHash: current.hash,
                        reason: `previousHash mismatch: block #${current.index} points to "${current.previousHash}", but block #${previous.index} has hash "${previous.hash}"`
                    }
                };
            }

            if (current.index !== previous.index + 1) {
                return {
                    valid: false,
                    error: {
                        blockIndex: current.index,
                        blockHash: current.hash,
                        reason: `Index sequence broken: block #${previous.index} is followed by block #${current.index} (expected #${previous.index + 1})`
                    }
                };
            }

            if (current.hash !== current.calculateHash()) {
                return {
                    valid: false,
                    error: {
                        blockIndex: current.index,
                        blockHash: current.hash,
                        reason: `Hash mismatch at block #${current.index}: stored hash "${current.hash}" does not match recalculated hash "${current.calculateHash()}". Data (type/data/previousHash) has been tampered with.`
                    }
                };
            }
        }

        return { valid: true, error: null };
    }

    /**
     * Boolean-обёртка для обратной совместимости.
     * @returns {boolean}
     */
    isValid() {
        return this.validateChain().valid;
    }

    /**
     * Возвращает текущее количество блоков в цепочке.
     * @returns {number} Длина цепочки блоков.
     */
    getChainLength() {
        return this.chain.length;
    }

    /**
     * Возвращает срез цепочки блоков для синхронизации.
     * @param {number} [fromIndex=0] - Начальный индекс.
     * @param {number} [limit=100] - Максимальное количество блоков.
     * @returns {Object[]} Массив сериализованных блоков.
     */
    getBlocks(fromIndex = 0, limit = 100) {
        if (fromIndex >= this.chain.length) {
            return [];
        }
        return this.chain
            .slice(fromIndex, fromIndex + limit)
            .map(block => block.toJSON());
    }

    /**
     * Валидирует и добавляет блок, полученный от соседней ноды по сети.
     * Строгий порядок проверок по контракту sprint4-requirements.md §3.4.
     * @param {Object} blockData - Сырой объект блока из JSON.
     * @returns {Object} Результат: { accepted: boolean, reason?: string, chainLength: number }.
     */
    addExternalBlock(blockData) {
        // 1. Своя цепочка целая
        const integrity = this.validateChain();
        if (!integrity.valid) {
            throw createChainError(
                'LOCAL_CHAIN_TAMPERED',
                `Local blockchain integrity check failed: ${integrity.error.reason}`,
                integrity.error
            );
        }

        // 2. Формат верхнего уровня: 6 полей, типы, index >= 0, хэши — 64 hex
        if (!blockData || typeof blockData !== 'object' || Array.isArray(blockData)) {
            throw createChainError('INVALID_FORMAT', 'Block must be a non-null object', {
                field: 'block',
                problem: 'must be an object'
            });
        }

        const requiredFields = ['index', 'timestamp', 'type', 'data', 'previousHash', 'hash'];
        for (const field of requiredFields) {
            if (!(field in blockData) || blockData[field] === undefined || blockData[field] === null) {
                throw createChainError('INVALID_FORMAT', `Missing required field: ${field}`, {
                    field,
                    problem: 'required field is missing'
                });
            }
        }

        if (!Number.isInteger(blockData.index) || blockData.index < 0) {
            throw createChainError('INVALID_FORMAT', 'Field index must be an integer >= 0', {
                field: 'index',
                problem: 'must be an integer >= 0'
            });
        }

        if (typeof blockData.timestamp !== 'string' || blockData.timestamp.trim() === '') {
            throw createChainError('INVALID_FORMAT', 'Field timestamp must be a non-empty string', {
                field: 'timestamp',
                problem: 'must be a non-empty string'
            });
        }

        if (typeof blockData.type !== 'string') {
            throw createChainError('INVALID_FORMAT', 'Field type must be a string', {
                field: 'type',
                problem: 'must be a string'
            });
        }

        if (typeof blockData.data !== 'object' || Array.isArray(blockData.data)) {
            throw createChainError('INVALID_FORMAT', 'Field data must be an object', {
                field: 'data',
                problem: 'must be a plain object'
            });
        }

        if (typeof blockData.previousHash !== 'string' || !HEX_64_REGEX.test(blockData.previousHash)) {
            throw createChainError('INVALID_FORMAT', 'Field previousHash must be 64 lowercase hex characters', {
                field: 'previousHash',
                problem: 'must be 64 lowercase hex characters'
            });
        }

        if (typeof blockData.hash !== 'string' || !HEX_64_REGEX.test(blockData.hash)) {
            throw createChainError('INVALID_FORMAT', 'Field hash must be 64 lowercase hex characters', {
                field: 'hash',
                problem: 'must be 64 lowercase hex characters'
            });
        }

        // 3. Тип блока: только ISSUE или REVOKE
        const ALLOWED_TYPES = ['ISSUE', 'REVOKE'];
        if (!ALLOWED_TYPES.includes(blockData.type)) {
            throw createChainError('INVALID_TYPE', `Block type "${blockData.type}" is not allowed from network`, {
                received: blockData.type,
                allowed: ALLOWED_TYPES
            });
        }

        // 4. Схема data соответствует типу (и никаких лишних полей)
        const dataKeys = Object.keys(blockData.data);
        if (blockData.type === 'ISSUE') {
            const expectedKeys = ['documentId', 'documentHash', 'issuerId', 'holderId'];
            for (const key of expectedKeys) {
                if (typeof blockData.data[key] !== 'string' || blockData.data[key].trim() === '') {
                    throw createChainError('INVALID_FORMAT', `Field data.${key} must be a non-empty string`, {
                        field: `data.${key}`,
                        problem: 'must be a non-empty string'
                    });
                }
            }
            if (!HEX_64_REGEX.test(blockData.data.documentHash)) {
                throw createChainError('INVALID_FORMAT', 'Field data.documentHash must be 64 lowercase hex characters', {
                    field: 'data.documentHash',
                    problem: 'must be 64 lowercase hex characters'
                });
            }
            const extraKey = dataKeys.find(k => !expectedKeys.includes(k));
            if (extraKey) {
                throw createChainError('INVALID_FORMAT', `Unexpected field in data: ${extraKey}`, {
                    field: `data.${extraKey}`,
                    problem: 'unexpected field'
                });
            }
        } else if (blockData.type === 'REVOKE') {
            const expectedKeys = ['documentId'];
            if (typeof blockData.data.documentId !== 'string' || blockData.data.documentId.trim() === '') {
                throw createChainError('INVALID_FORMAT', 'Field data.documentId must be a non-empty string', {
                    field: 'data.documentId',
                    problem: 'must be a non-empty string'
                });
            }
            const extraKey = dataKeys.find(k => !expectedKeys.includes(k));
            if (extraKey) {
                throw createChainError('INVALID_FORMAT', `Unexpected field in data: ${extraKey}`, {
                    field: `data.${extraKey}`,
                    problem: 'unexpected field'
                });
            }
        }

        // 5. Пересчитанный hash === присланному
        const candidateBlock = new Block(
            blockData.index,
            blockData.timestamp,
            blockData.type,
            blockData.data,
            blockData.previousHash,
            blockData.hash
        );
        const recalculatedHash = candidateBlock.calculateHash();
        if (recalculatedHash !== blockData.hash) {
            throw createChainError('INVALID_HASH', 'Block hash does not match recalculated hash', {
                expected: recalculatedHash,
                received: blockData.hash
            });
        }

        // 6 & 7. Проверка занятости index (дубликат или конфликт)
        if (blockData.index < this.chain.length) {
            const existingBlock = this.chain[blockData.index];
            if (existingBlock.hash === blockData.hash) {
                return {
                    accepted: false,
                    reason: 'DUPLICATE_BLOCK',
                    chainLength: this.chain.length
                };
            }
            throw createChainError('BLOCK_CONFLICT', `Block conflict at index ${blockData.index}`, {
                index: blockData.index,
                localHash: existingBlock.hash,
                receivedHash: blockData.hash
            });
        }

        // 8a. Проверка на разрыв индексов (дырка)
        const latest = this.getLatestBlock();
        if (blockData.index > latest.index + 1) {
            throw createChainError('CHAIN_GAP', `Chain gap: expected index ${latest.index + 1}, got ${blockData.index}`, {
                receivedIndex: blockData.index,
                expectedIndex: latest.index + 1
            });
        }

        // 8b. Проверка стыковки с предыдущим хэшем
        if (blockData.previousHash !== latest.hash) {
            throw createChainError('PREV_HASH_MISMATCH', 'previousHash does not match latest block hash', {
                expected: latest.hash,
                received: blockData.previousHash
            });
        }

        // 9. Бизнес-правила
        if (blockData.type === 'ISSUE') {
            for (const block of this.chain) {
                if (block.type === 'ISSUE') {
                    if (block.data.documentId === blockData.data.documentId) {
                        throw createChainError('DUPLICATE_DOCUMENT', `Document already exists with ID: ${blockData.data.documentId}`, {
                            field: 'documentId',
                            value: blockData.data.documentId
                        });
                    }
                    if (block.data.documentHash === blockData.data.documentHash) {
                        throw createChainError('DUPLICATE_DOCUMENT', `Document already exists with hash: ${blockData.data.documentHash}`, {
                            field: 'documentHash',
                            value: blockData.data.documentHash
                        });
                    }
                }
            }
        } else if (blockData.type === 'REVOKE') {
            let foundIssue = false;
            let foundRevoke = false;
            for (const block of this.chain) {
                if (block.type === 'ISSUE' && block.data.documentId === blockData.data.documentId) {
                    foundIssue = true;
                }
                if (block.type === 'REVOKE' && block.data.documentId === blockData.data.documentId) {
                    foundRevoke = true;
                }
            }
            if (!foundIssue) {
                throw createChainError('DOCUMENT_NOT_FOUND', `Document ${blockData.data.documentId} not found`, {
                    documentId: blockData.data.documentId
                });
            }
            if (foundRevoke) {
                throw createChainError('ALREADY_REVOKED', `Document ${blockData.data.documentId} already revoked`, {
                    documentId: blockData.data.documentId
                });
            }
        }

        // 10. Добавляем блок и сохраняем на диск
        this.chain.push(candidateBlock);
        this.save();

        return {
            accepted: true,
            chainLength: this.chain.length
        };
    }
}

module.exports = { Block, Blockchain };