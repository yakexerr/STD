# Тестовые сценарии спринта 4 — взаимодействие нод

Тз: `sprint4-requirements.md`. Архитектура и запуск: `sprint4-architecture.md` §3.
Каждый сценарий: ID → шаги → ожидаемый результат. Негативные сценарии обязательны все.

## 1. Стенд и подготовка

- **N1** = нода 1 (`http://localhost:5001`), **N2** = нода 2 (`http://localhost:5002`).
- Запуск: `npm run start:node1`, `npm run start:node2` (+ фронт при UI-проверках). Bootstrap из §3.4 архитектуры выполнен ДО первого запуска.
- Токен: `X-Network-Token: std-network-secret` (далее — заголовок `T`).
- Предусловие: `GET /api/node/info` на обеих нодах отвечает 200, `networkId` совпадает.
- **Проверка неизменности** (для всех негативных кейсов): до и после запроса сравнить `chainLength` и `latestBlock.hash` у принимающей ноды — должны быть идентичны.

**Заготовка блока для ручных тестов** (из корня репо; `<HASH>` = latestBlock.hash принимающей ноды, `<N>` = её chainLength):
```bash
node -e "const {Block}=require('./blockchain/blockchain'); console.log(JSON.stringify({block:new Block(<N>, new Date().toISOString(), 'ISSUE', {documentId:'999', documentHash:'a'.repeat(64), issuerId:'1', holderId:'2'}, '<HASH>').toJSON()}))"
```
Скрипт печатает готовое тело запроса с корректным хэшем. Для негативных кейсов меняем в нём одно поле (что именно — указано в шагах). Сохранить в `block.json`, слать так:
```bash
curl -X POST -H "X-Network-Token: std-network-secret" -H "Content-Type: application/json" -d @block.json http://localhost:5002/api/node/blocks
```

## 2. Позитивные сценарии

### A. Запуск и окружение

| ID | Шаги | Ожидаемый результат |
|---|---|---|
| A1 | Запустить N1 и N2 | Обе стартовали, в логах порты 5001/5002 |
| A2 | Проверить файлы | N1 пишет `data/node1.json`, N2 — `data/node2.json`, файлы разные |
| A3 | `GET /info` на обеих | `networkId` одинаковый, `nodeId` разные |
| A4 | Запустить обычный `npm start` | Старый одно-нодовый режим работает на :5000 как в спринте 3 |

### B. Информация и чтение блоков

| ID | Шаги | Ожидаемый результат |
|---|---|---|
| B1 | `GET /api/node/info` с `T` | 200, все поля контракта §3.1 (nodeId, networkId, chainLength, latestBlock, peers) |
| B2 | `GET /blocks?fromIndex=0&limit=5` | 200, `blocks.length === 5`, `total` = длина цепочки, блоки идут по порядку |
| B3 | `GET /blocks?fromIndex=9999` | 200, `blocks: []`, `count: 0` |
| B4 | `GET /blocks/1` | 200, блок с index 1, поля совпадают с файлом ноды |
| B5 | `GET /blocks?limit=1000` | 200 (максимальный limit разрешён) |

### C. Push — распространение блока

| ID | Шаги | Ожидаемый результат |
|---|---|---|
| C1 | Через фронт (или API) N1 выпустить диплом | 201; `chainLength` N2 вырос на 1 без ручных действий; в логе N1 строка `[p2p] block #… → …: 201` |
| C2 | Тот же PDF загрузить в проверку на N2 (`/api/validation/check`) | `VALID` |
| C3 | Отозвать документ на N1, проверить PDF на N2 | `REVOKED` на N2 |
| C4 | Сравнить новый блок в `data/node1.json` и `data/node2.json` | Побайтово одинаковые index/hash/data |

### E. Sync — ручной pull

| ID | Шаги | Ожидаемый результат |
|---|---|---|
| E1 | Остановить N2 → выпустить 2 документа на N1 → запустить N2 → `POST /api/node/sync {}` на N2 | 200, `results[0].ok=true, fetched=2, applied=2`; chainLength N2 == N1; PDF обоих документов `VALID` на N2 |
| E2 | `POST /sync {}` когда цепочки равны | 200, `fetched=0, applied=0`, ошибок нет |
| E3 | `POST /sync {"peerUrl":"http://localhost:5001"}` | 200, в results ровно один сосед |

## 3. Негативные сценарии

### D. Приём некорректного блока (POST /api/node/blocks на N2)

Для D2–D13: взять заготовку из §1, изменить указанное поле. После каждого — проверка неизменности цепочки N2.

| ID | Что отправляем | Ожидаемый результат |
|---|---|---|
| D1a | Запрос без заголовка `T` | 401 `UNAUTHORIZED` |
| D1b | Заголовок с неверным токеном | 401 `UNAUTHORIZED` |
| D2 | Удалить поле `previousHash` (или тело без обёртки `block`) | 400 `INVALID_FORMAT`, details.field указывает на проблему |
| D3 | `hash: "xyz"` (не 64 hex) | 400 `INVALID_FORMAT` |
| D4 | `type: "BEGIN"` | 422 `INVALID_TYPE` |
| D5 | Поменять `data.holderId` на `"hacker"`, hash не трогать | 422 `INVALID_HASH`, details.expected ≠ details.received |
| D6 | Прислать блок, который у N2 уже есть (взять её последний блок), дважды | 200 `accepted:false, reason:"DUPLICATE_BLOCK"`; дубль не создан |
| D7 | Заготовку с index = последний index N2, но другим data (пересчитать hash скриптом) | 409 `BLOCK_CONFLICT` |
| D8 | Заготовку с index = chainLength N2 + 5 | 409 `CHAIN_GAP`, details.expectedIndex = chainLength N2 |
| D9 | Заготовку с правильным index, но `previousHash` = 64 нуля | 422 `PREV_HASH_MISMATCH` |
| D10 | Валидный следующий блок ISSUE с documentId уже существующего документа | 422 `DUPLICATE_DOCUMENT`, details.field = documentId |
| D11 | Валидный следующий блок ISSUE с documentHash уже существующего документа | 422 `DUPLICATE_DOCUMENT`, details.field = documentHash |
| D12 | Валидный следующий блок REVOKE с `documentId: "999999"` | 422 `DOCUMENT_NOT_FOUND` |
| D13 | Валидный следующий блок REVOKE для уже отозванного документа | 422 `ALREADY_REVOKED` |
| D14 | Цепочка самой N2 повреждена в памяти (только автотест: испортить `bc.chain[1].data` после загрузки) | 503 `LOCAL_CHAIN_TAMPERED`, details из validateChain |

Примечание: D14 вручную не воспроизводится — после восстановления проверки в `load()` нода с битым файлом просто не стартует (см. R3).

### F. Ошибки параметров и соседей

| ID | Шаги | Ожидаемый результат |
|---|---|---|
| F1 | `POST /sync {"peerUrl":"http://localhost:5999"}` (никто не слушает) | 200, в results `ok:false`, `error.code:"PEER_UNAVAILABLE"`; своя цепочка не тронута |
| F2 | Поднять N3 с ЧУЖИМ genesis: создать `.env.node3` (PORT=5003, BLOCKCHAIN_FILE=data/node3.json, PEERS=http://localhost:5001, тот же токен), файл data/node3.json НЕ копировать, запустить; на N3 `POST /sync {}` | 200, `error.code:"GENESIS_MISMATCH"`, applied=0 |
| F3 | `POST /sync {"peerUrl":"мусор"}` | 400 `INVALID_PARAMS` |
| F4 | `GET /blocks?fromIndex=-1`, `?limit=0`, `?limit=5000`, `?fromIndex=abc` | 400 `INVALID_PARAMS` (каждый) |
| F5 | `GET /blocks/99999` | 404 `BLOCK_NOT_FOUND` |

### G. Устойчивость

| ID | Шаги | Ожидаемый результат |
|---|---|---|
| G1 | Остановить N2 → выпустить документ на N1 | Выпуск успешен (201), документ в БД и цепочке N1; в логе N1 ошибка доставки до N2 |
| G2 | Запустить N2 → `POST /sync {}` на N2 | Цепочка догнана (как E1), документ `VALID` на N2 |
| G3 | Повторить C1 дважды с одним и тем же блоком (переотправка) | Второй раз 200 `DUPLICATE_BLOCK`, состояние N2 не изменилось |

## 4. Регрессия (спринты 1–3)

| ID | Шаги | Ожидаемый результат |
|---|---|---|
| R1 | `npm test` из корня | Все существующие + новые тесты зелёные |
| R2 | Полный бизнес-флоу на N1: регистрация → вход → выпуск → список → отзыв → проверка → история | Работает как в спринте 3, форматы ответов бизнес-API не изменились |
| R3 | Испортить `data/node2.json` (поправить data в любом блоке) → запустить N2 | Нода НЕ стартует, в логе ошибка целостности. Это ожидаемое изменение спринта 4: раньше битый файл загружался молча |

## 5. Автоматизация

- **Jest (юнит, обязательно):** D2–D14 — новый файл `tests/blockchainExternal.test.js`, прямые вызовы `addExternalBlock()` на экземпляре с временным файлом; плюс `getBlocks()` (срезы, границы) и падение `load()` на битом файле (R3).
- **Jest (по возможности):** B2–B5, F4–F5 через supertest на поднятом app.
- **Вручную (чеклист):** A, C, E, F1–F3, G — требуют двух живых процессов.
- Отчёт тестировщика: таблица ID / статус (PASS/FAIL) / комментарий, приложить к PR.

## 6. Критерии завершения тестирования

- Все сценарии D возвращают ТОЧНЫЙ код из контракта (не просто 4xx) и не меняют цепочку.
- C1–C4 и E1 проходят на живых двух нодах.
- G1: недоступность соседа не ломает выпуск.
- R1–R3 зелёные.