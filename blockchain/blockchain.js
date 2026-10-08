'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

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
     * При загрузке из файла используется оригинальный хэш из файла для валидации целостности.
     * @param {number} index - Порядковый индекс блока в цепочке.
     * @param {string} timestamp - Временная метка создания блока в формате ISO 8601.
     * @param {string} type - Тип блока: "BEGIN", "ISSUE" или "REVOKE".
     * @param {Object} data - Пользовательские данные блока.
     * @param {string} previousHash - SHA-256 хэш предыдущего блока.
     * @param {string|null} [hash=null] - Оригинальный хэш блока (при загрузке из файла) или null (при создании).
     */
    constructor(index, timestamp, type, data, previousHash, hash = null) {
        this.index = index;
        this.timestamp = timestamp;
        this.type = type;
        this.data = data;
        this.previousHash = previousHash;
        // Если hash передан (загрузка из файла) — используем его для валидации целостности.
        // Если не передан (создание нового блока) — вычисляем на основе содержимого.
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
 * Управляет хранением цепочки в JSON-файле, валидацией целостности
 * и операциями выпуска/отзыва документов.
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
     * Если файл отсутствует или пуст - инициализирует genesis-блок.
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

            // Проверяем, что содержимое файла является массивом блоков
            if (!Array.isArray(parsedChain)) {
                throw new Error('Blockchain file is corrupted: expected an array');
            }

            // Восстанавливаем блоки, передавая оригинальные хэши из файла.
            // Это позволяет обнаруживать подделку данных при проверке целостности:
            // если злоумышленник изменит содержимое блока, сохранённый хэш
            // не совпадёт с пересчитанным, и isValid() вернёт false.
            this.chain = parsedChain.map(blockData =>
                new Block(
                    blockData.index,
                    blockData.timestamp,
                    blockData.type,
                    blockData.data,
                    blockData.previousHash,
                    blockData.hash  // ← оригинальный хэш из файла
                )
            );

            if (!this.isValid()) {
                throw new Error('Blockchain integrity check failed on load');
            }
        } catch (error) {
            // Пробрасываем специфичные ошибки без обёртки для точной диагностики
            if (error.message === 'Blockchain integrity check failed on load' ||
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
            fs.writeFileSync(this.filePath, JSON.stringify(this.chain, null, 2), 'utf8');
        } catch (error) {
            throw new Error(`Failed to save blockchain: ${error.message}`);
        }
    }

    /**
     * Создает и добавляет genesis-блок (начальный блок цепочки с индексом 0).
     */
    createGenesisBlock() {
        const genesisBlock = new Block(0, new Date().toISOString(), "BEGIN", {}, "0");
        this.chain = [genesisBlock];
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
     * Проверяет уникальность как documentId, так и documentHash по всей цепочке.
     * @param {string} documentId - Уникальный идентификатор документа (UUID).
     * @param {string} documentHash - SHA-256 хэш содержимого документа.
     * @param {string} issuerId - Идентификатор эмитента (ВУЗа).
     * @param {string} holderId - Идентификатор владельца документа.
     * @returns {Block} Созданный блок типа ISSUE.
     * @throws {TypeError} Если какой-либо из параметров не является непустой строкой.
     * @throws {Error} Если документ с таким ID уже зарегистрирован.
     * @throws {Error} Если документ с таким хэшем уже зарегистрирован.
     */
    issueDocument(documentId, documentHash, issuerId, holderId) {
        // Валидация входных параметров
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

        // Проверяем уникальность documentId и documentHash по всей цепочке
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
     * Использует двухпроходную логику: сначала собирает информацию о документе,
     * затем принимает решение о возможности отзыва.
     * @param {string} documentId - Идентификатор отзываемого документа.
     * @returns {Block} Созданный блок типа REVOKE.
     * @throws {TypeError} Если documentId не является непустой строкой.
     * @throws {Error} Если документ с таким ID не найден в цепочке.
     * @throws {Error} Если документ уже был отозван ранее.
     */
    revokeDocument(documentId) {
        // Валидация входного параметра
        if (typeof documentId !== 'string' || documentId.trim() === '') {
            throw new TypeError('documentId must be a non-empty string');
        }

        // Первый проход: собираем информацию
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

        // Второй проход: принимаем решение на основе собранной информации
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
     * @throws {TypeError} Если documentHash не является непустой строкой.
     */
    checkDocument(documentHash) {
        // Валидация входного параметра
        if (typeof documentHash !== 'string' || documentHash.trim() === '') {
            throw new TypeError('documentHash must be a non-empty string');
        }

        // Ищем блок ISSUE с указанным хэшем
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

        // Если ISSUE найден, проверяем наличие блока REVOKE для этого документа
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
     * и корректность вычисленных хэшей каждого блока (обнаруживает подделку данных).
     * @returns {boolean} true, если цепочка валидна, иначе false.
     */
    isValid() {
        if (this.chain.length === 0) {
            return false;
        }

        // Проверяем genesis-блок
        const genesis = this.chain[0];
        if (
            genesis.index !== 0 ||
            genesis.previousHash !== "0" ||
            genesis.type !== "BEGIN" ||
            genesis.hash !== genesis.calculateHash()
        ) {
            return false;
        }

        // Проверяем все последующие блоки
        for (let i = 1; i < this.chain.length; i++) {
            const current = this.chain[i];
            const previous = this.chain[i - 1];

            // Проверяем связь с предыдущим блоком (цепочка хэшей)
            if (current.previousHash !== previous.hash) {
                return false;
            }

            // Проверяем последовательность индексов
            if (current.index !== previous.index + 1) {
                return false;
            }

            // Проверяем целостность данных: сохранённый хэш должен совпадать
            // с пересчитанным. Если содержимое блока было изменено,
            // calculateHash() даст другое значение и проверка упадёт.
            if (current.hash !== current.calculateHash()) {
                return false;
            }
        }

        return true;
    }

    /**
     * Возвращает текущее количество блоков в цепочке.
     * @returns {number} Длина цепочки блоков.
     */
    getChainLength() {
        return this.chain.length;
    }
}

module.exports = { Block, Blockchain };