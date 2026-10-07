# Архитектура и технические требования к реализации (Спринт 2)

## 1. Client (localhost:3000)
* **`auth.jsx`**: логин и регистрация пользователей.
* **`account.jsx`**: управление личным кабинетом, просмотр выданных дипломов или выпущенных пользователем документов (для роли `ISSUER`), история запросов на верификацию.
* **`validation.jsx`**: публичная проверка подлинности (загрузка файла, вычисление хэша, отправка на сервер, проверка в блокчейне и вывод статуса: `VALID` / `REVOKED` / `NOT_FOUND`).
* При увеличении количества функций на страницах выносить логику в отдельные файлы сервисов (`*Service.js`).


## 2. Backend (localhost:5000)
* **`server.js`**: Express-сервер, обрабатывающий HTTP-запросы и предоставляющий API-эндпоинты. Взаимодействует с базой данных MySQL (через ORM) и с ядром блокчейна через импорт модуля `blockchain.js`.


## 3. Блокчейн-ядро

### 3.1. Модуль `blockchain.js`
Класс или модуль для работы с цепочкой блоков, подсчета хэшей, добавления записей и контроля целостности данных.

#### 3.1.1. Правила подсчета хэша блока
* Для подсчета используется встроенная библиотека Node.js `crypto` (алгоритм SHA-256).
* Строка для вычисления хэша формируется конкатенацией полей блока:
  ```javascript
  const rawString = String(index) + timestamp + type + JSON.stringify(data) + previousHash;
  const hash = crypto.createHash('sha256').update(rawString).digest('hex');
  ```
- Порядок ключей в объекте `data` должен быть детерминированным при сериализации в JSON.

#### 3.1.2. Методы класса:

- **`issueDocument(documentId, documentHash, issuerId, holderId)`**:
    - Проверяет, нет ли уже в блокчейне блока с таким `documentId` или `documentHash`. При наличии выбрасывает ошибку.
    - Формирует и добавляет в цепочку блок с типом `ISSUE`.
    - Сохраняет изменения в `blockchain.json` и возвращает созданный блок.
- **`revokeDocument(documentId)`**:
    - Проверяет цепочку: документ с данным `documentId` обязан существовать в блоке `ISSUE` и не должен быть ранее отозван блоком `REVOKE`.
    - Формирует и добавляет в цепочку блок с типом `REVOKE`.
    - Сохраняет изменения в `blockchain.json` и возвращает созданный блок.
- **`checkDocument(documentHash)`**:
    - Сканирует цепочку в поисках блока `ISSUE` с совпадающим `documentHash`.
    - Если блок не найден – возвращает `{ isValid: false, status: "NOT_FOUND" }`.
    - Если блок найден – проверяет наличие последующего блока `REVOKE` с тем же `documentId`.
    - При наличии блока отзыва – возвращает `{ isValid: false, status: "REVOKED" }`.
    - Если отзыв отсутствует – возвращает `{ isValid: true, status: "VALID" }`.

- **`isValid()`**:
    - Проверяет корректность нулевого блока: `index === 0`, `previousHash === "0"`, вычисленный хэш совпадает со значением в поле `hash`.
    - Проходит циклом по всем последующим блокам (от 1 до конца):
        - `currentBlock.previousHash === previousBlock.hash`
        - `currentBlock.index === previousBlock.index + 1`
        - Вычисленный заново хэш текущего блока строго равен его полю `hash`. 
    - Возвращает `true`, если вся цепочка валидна, иначе `false`.
        

### 3.2. Файл хранилища `blockchain.json`

Файл долгосрочного хранения реестра (JSON-массив блоков).
- **Поведение при старте программы:**
    - Если файл отсутствует или пуст – автоматически создается начальный блок (`BEGIN`) и записывается в файл.
    - Если файл существует – массив блоков считывается в память и валидируется через `isValid()`. При нарушении целостности выбрасывается ошибка.
        
#### 3.2.1. Структура блока `BEGIN` (Genesis-блок)

``` JSON
{
  "index": 0,
  "timestamp": "2026-10-07T20:00:00.000Z",
  "type": "BEGIN",
  "data": {},
  "previousHash": "0",
  "hash": "..."
}
```

#### 3.2.2. Структура блока `ISSUE` (Выпуск документа)

``` JSON
{
  "index": 1,
  "timestamp": "2026-10-07T20:05:00.000Z",
  "type": "ISSUE",
  "data": {
    "documentId": 123,
    "documentHash": "abc123...",
    "issuerId": 10,
    "holderId": 25
  },
  "previousHash": "...",
  "hash": "..."
}
```

#### 3.2.3. Структура блока `REVOKE` (Отзыв документа)



``` JSON
{
  "index": 2,
  "timestamp": "2026-10-07T20:10:00.000Z",
  "type": "REVOKE",
  "data": {
    "documentId": 123
  },
  "previousHash": "...",
  "hash": "..."
}
```

## 4. Хранилище файлов документов

- Загружаемые PDF-файлы сохраняются локально на сервере в выделенной папке (например, `uploads/`).
- Для каждого файла генерируется случайное уникальное имя (UUID), в базу данных записывается только сгенерированное имя.

## 5. Схема базы данных MySQL

### 5.1. Таблица `users`

- `id` (INT, PK, AUTO_INCREMENT)
- `email` (VARCHAR, UNIQUE)
- `password_hash` (VARCHAR)
- `role` (ENUM: `'ISSUER'`, `'HOLDER'`)

### 5.2. Таблица `documents`

- `id` (INT, PK, AUTO_INCREMENT)
- `type` (ENUM: `'CERTIFICATE'`, `'DIPLOMA'`)
- `issuer_id` (INT, FK -> `users.id`)
- `holder_id` (INT, FK -> `users.id`)
- `file_name` (VARCHAR)
- `document_hash` (VARCHAR)
- `status` (ENUM: `'VALID'`, `'REVOKED'`)
- `issued_at` (DATETIME)

### 5.3. Таблица `verification_requests`

- `id` (INT, PK, AUTO_INCREMENT)
- `user_id` (INT, NULL, FK -> `users.id`)
- `document_hash` (VARCHAR)
- `result` (ENUM: `'VALID'`, `'INVALID'`)
- `created_at` (DATETIME)