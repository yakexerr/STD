# Требования к взаимодействию нод (спринт 4)

Контракт P2P API. Архитектура и обоснования — в `sprint4-architecture.md`.


## 1. Общие правила

- База адреса ноды: `http://localhost:<PORT>` (5001 / 5002 в демо).
- Все тела запросов и ответов — JSON (UTF-8).
- Все `/api/node/*` требуют заголовок `X-Network-Token: <NETWORK_TOKEN>`. Если в конфиге ноды токен пустой — проверка отключена (dev-режим).
- **Формат ошибки P2P** (в отличие от бизнес-API, где `{ "error": "текст" }`):
```json
{ "error": { "code": "INVALID_HASH", "message": "Описание", "details": { } } }
```
`code` — машинный код из таблиц ниже (по нему пишутся тесты), `details` — машинные подробности, состав зависит от кода.
- Ответы бизнес-API (`/api/auth`, `/api/documents`, `/api/validation`) в этом спринте **не меняются**.

## 2. Формат блока (не меняется, см. sprint2-architecture.md)

```json
{
  "index": 7,
  "timestamp": "2026-11-12T10:00:00.000Z",
  "type": "ISSUE",
  "data": { "documentId": "6", "documentHash": "<64 hex>", "issuerId": "4", "holderId": "3" },
  "previousHash": "<64 hex>",
  "hash": "<64 hex>"
}
```
Хэш = SHA-256 от `String(index) + timestamp + type + deterministicStringify(data) + previousHash` (ключи data сортируются рекурсивно). Принимающая нода пересчитывает хэш **от присланных полей**, ничего не подставляя своего.

## 3. Эндпоинты

### 3.1. GET /api/node/info

Информация о ноде. Ответ `200`:
```json
{
  "nodeId": "node-1",
  "version": "1.0",
  "networkId": "<hash genesis-блока>",
  "chainLength": 8,
  "latestBlock": { "index": 7, "hash": "<64 hex>", "type": "ISSUE", "timestamp": "..." },
  "peers": ["http://localhost:5002"]
}
```

### 3.2. GET /api/node/blocks?fromIndex=&limit=

Блоки диапазоном (для синхронизации). Параметры:

| Параметр | По умолчанию | Ограничения |
|---|---|---|
| `fromIndex` | 0 | целое ≥ 0 |
| `limit` | 100 | целое 1..1000 |

Ответ `200`: `{ "fromIndex": 5, "limit": 100, "total": 8, "count": 3, "blocks": [ ... ] }`
(`total` — длина цепочки, `count` — сколько отдали). Если `fromIndex >= total` → `200` с пустым `blocks`. Невалидные параметры → `400 INVALID_PARAMS`.

### 3.3. GET /api/node/blocks/:index

Один блок. `200 { "block": { ... } }`. Нет такого → `404 BLOCK_NOT_FOUND`, details: `{ index, chainLength }`.

### 3.4. POST /api/node/blocks — приём блока (ключевой эндпоинт)

Тело: `{ "block": { ...блок целиком... } }`.

Успех `201`: `{ "accepted": true, "chainLength": 9 }`
Дубликат `200`: `{ "accepted": false, "reason": "DUPLICATE_BLOCK", "chainLength": 8 }` — блок с таким index и hash уже есть; это НЕ ошибка (идемпотентность: повторная доставка безопасна).

Отказ — статус и `error.code` по месту провала проверки. **Порядок проверок строго такой:**

| # | Проверка | code | HTTP | details |
|---|---|---|---|---|
| 1 | своя цепочка целая (validateChain) | `LOCAL_CHAIN_TAMPERED` | 503 | `{ blockIndex, blockHash, reason }` |
| 2 | все 6 полей, типы, хэши = 64 hex | `INVALID_FORMAT` | 400 | `{ field, problem }` |
| 3 | type ∈ {ISSUE, REVOKE} | `INVALID_TYPE` | 422 | `{ received, allowed }` |
| 4 | пересчитанный hash === присланному | `INVALID_HASH` | 422 | `{ expected, received }` |
| 5 | index занят тем же блоком | → `200 DUPLICATE_BLOCK` | 200 | — |
| 6 | index занят ДРУГИМ хэшем | `BLOCK_CONFLICT` | 409 | `{ index, localHash, receivedHash }` |
| 7a | index > latest.index + 1 (дырка) | `CHAIN_GAP` | 409 | `{ receivedIndex, expectedIndex }` |
| 7b | previousHash !== latest.hash | `PREV_HASH_MISMATCH` | 422 | `{ expected, received }` |
| 8a | ISSUE: documentId или documentHash уже в цепочке | `DUPLICATE_DOCUMENT` | 422 | `{ field, value }` |
| 8b | REVOKE: документа нет | `DOCUMENT_NOT_FOUND` | 422 | `{ documentId }` |
| 8c | REVOKE: уже отозван | `ALREADY_REVOKED` | 422 | `{ documentId }` |

Любой отказ = цепочка и файл ноды **не изменились**. `BEGIN` из сети не принимается (шаг 3).

### 3.5. POST /api/node/sync — ручная синхронизация (pull)

Тело: `{}` (со всеми соседями из PEERS) или `{ "peerUrl": "http://localhost:5001" }` (с одним).

Алгоритм для каждого соседа:
1. `GET /info`; недоступен/таймаут → в результат `PEER_UNAVAILABLE`;
2. `networkId` не совпал → `GENESIS_MISMATCH`, соседа пропускаем;
3. его `chainLength` > нашего → `GET /blocks?fromIndex=<наша длина>&limit=100`, повторять пока догоним;
4. применять блоки по одному через `addExternalBlock`; дубликат — не ошибка, идём дальше; первый отказ → стоп по этому соседу, код отказа в результат.

Ответ всегда `200` (ошибки соседей — внутри results):
```json
{
  "results": [
    { "peer": "http://localhost:5001", "ok": true, "fetched": 3, "applied": 3 },
    { "peer": "http://localhost:5003", "ok": false, "fetched": 0, "applied": 0,
      "error": { "code": "PEER_UNAVAILABLE", "message": "timeout" } }
  ],
  "chainLength": 11
}
```
Невалидный `peerUrl` → `400 INVALID_PARAMS`.

### 3.6. GET /api/status — статус для UI (опционально, P2)

Без токена (публичный, для страницы «Состояние ноды»). Сервер сам опрашивает соседей с токеном (таймаут 2с):
```json
{
  "nodeId": "node-1", "chainLength": 8,
  "latestBlock": { "index": 7, "hash": "..." },
  "peers": [ { "url": "http://localhost:5002", "online": true, "chainLength": 8, "networkMatch": true } ]
}
```
Недоступный сосед: `{ "url": ..., "online": false }`.

## 4._transportные и служебные ошибки

| code | HTTP | Когда |
|---|---|---|
| `UNAUTHORIZED` | 401 | нет/неверный X-Network-Token на /api/node/* |
| `INVALID_PARAMS` | 400 | плохие query/тело (не блок) |
| `BLOCK_NOT_FOUND` | 404 | GET блока с несуществующим index |
| `PEER_UNAVAILABLE` | внутри results у sync | сосед не ответил за P2P_TIMEOUT_MS |
| `GENESIS_MISMATCH` | внутри results у sync | networkId соседа отличается |
| `INTERNAL_ERROR` | 500 | всё остальное |

## 5. Правила рассылки (push) при выпуске/отзыве

- Триггер: успешный `commit` в documentService (issue и revoke).
- Кому: всем из `PEERS`, параллельно, `POST /api/node/blocks`, таймаут `P2P_TIMEOUT_MS`.
- Результат по каждому соседу — в лог: `[p2p] block #7 → http://localhost:5002: 201 accepted`.
- Недоставка НЕ влияет на ответ бизнес-API и НЕ откатывает документ. Ретраев нет.
- Полученные из сети блоки дальше НЕ пересылаются.

## 6. Функциональные требования (дополнение к ФТ спринта 1)

- **FR-P2P-01.** Система должна запускаться в режиме ≥2 независимых нод, каждая со своим файлом блокчейна (конфиг §3 архитектуры).
- **FR-P2P-02.** Нода должна знать соседей по адресам из `PEERS` и уметь опрашивать их (`/info`).
- **FR-P2P-03.** Нода должна отдавать своё состояние и блоки по запросу (`/info`, `/blocks`).
- **FR-P2P-04.** После выпуска/отзыва документа нода должна отправлять новый блок всем соседям.
- **FR-P2P-05.** Нода должна принимать блок из сети только после всех проверок §3.4 и отклонять некорректные с `code` и `details`.
- **FR-P2P-06.** Повторная доставка того же блока не должна создавать дубль (идемпотентность).
- **FR-P2P-07.** Нода должна у вручную догонять цепочку соседа (`/sync`), проверяя совместимость сети по genesis.
- **FR-P2P-08.** Недоступность соседей не должна ломать бизнес-операции ноды.

## 7. Быстрая проверка (curl, для тестировщика)

```bash
# инфо ноды 2
curl -H "X-Network-Token: std-network-secret" http://localhost:5002/api/node/info

# блоки ноды 1 с 5-го
curl -H "X-Network-Token: std-network-secret" "http://localhost:5001/api/node/blocks?fromIndex=5&limit=10"

# ручной pull нодой 2
curl -X POST -H "X-Network-Token: std-network-secret" -H "Content-Type: application/json" -d "{}" http://localhost:5002/api/node/sync

# негатив: блок с испорченным хэшем (взять реальный блок из GET /blocks и поменять hash)
curl -X POST -H "X-Network-Token: std-network-secret" -H "Content-Type: application/json" -d "{\"block\": { ... }}" http://localhost:5002/api/node/blocks
# ожидаем 422 INVALID_HASH, цепочка не изменилась
```

Полный список сценариев (позитив/негатив) — в `sprint4-test-scenarios.md`.
