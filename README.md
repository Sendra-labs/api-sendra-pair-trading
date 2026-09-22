# Market-Neutral Intelligence Engine

RESTful API for market-neutral long/short pair analysis. OHLCV comes from the Hyperliquid candle API, with Binance as fallback when a coin is not listed there.

## Base URL

```
{baseUrl}/api
```

Replace `{baseUrl}` with your server URL (e.g., `https://api.example.com` or `http://localhost:3001`).

## Authentication

Currently, no authentication is required. All endpoints are publicly accessible.

## Endpoints

### POST /analyze

Analyzes a long/short trading strategy between two tokens.

**Request Body:**
```json
{
  "longToken": "BTCUSDT",
  "shortToken": "ETHUSDT",
  "timePeriod": 100
}
```

**Parameters:**
- `longToken` (required, string): Token symbol for long position
- `shortToken` (required, string): Token symbol for short position
- `timePeriod` (optional, number): Analysis period in days (default: 100)

**Response:**
```json
{
  "pair": "LONG BTCUSDT/SHORT ETHUSDT",
  "stats": {
    "longToken": "BTCUSDT",
    "shortToken": "ETHUSDT",
    "totalDays": 100,
    "validDays": 95,
    "winRate": 58.5,
    "totalProfit": 12.34,
    "totalProfitFromPrices": 12.34,
    "averageDailyProfit": 0.13,
    "sharpeRatio": 0.45,
    "recommendation": "BUY",
    "confidence": 75.5
  },
  "recommendation": "BUY",
  "confidence": 75.5,
  "marketCapAlignment": {
    "level": "HIGH",
    "score": 100,
    "description": "Both tokens are high market cap, similar volatility expected",
    "longTokenCategory": "H",
    "shortTokenCategory": "H"
  }
}
```

**Market Cap Alignment Levels:**
- `HIGH` (score 100): Both tokens have similar market cap categories (H-H, M-M, L-L, SUPERL-SUPERL)
- `MEDIUM` (score 50-70): Moderate difference in market cap (H-M, M-L, L-SUPERL)
- `LOW` (score 30-40): Significant difference in market cap (H-L, M-SUPERL)
- `VERY_LOW` (score 20): Extreme difference in market cap (H-SUPERL)

**Market Cap Categories:**
- `H`: High market cap (BTC, ETH, SOL, BNB, XRP)
- `M`: Medium market cap (LINK, AVAX, DOGE, ADA, XLM)
- `L`: Low market cap (most altcoins)
- `SUPERL`: Very low market cap (meme coins, low liquidity tokens)

**Example:**
```bash
curl -X POST {baseUrl}/api/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "longToken": "BTCUSDT",
    "shortToken": "ETHUSDT",
    "timePeriod": 100
  }'
```

---

### POST /delta-neutral

Analyzes a delta-neutral strategy using two token pairs.

**Request Body:**
```json
{
  "strategyA": {
    "longToken": "BTCUSDT",
    "shortToken": "ETHUSDT"
  },
  "strategyB": {
    "longToken": "LINKUSDT",
    "shortToken": "SOLUSDT"
  },
  "timePeriod": 100
}
```

**Parameters:**
- `strategyA.longToken` (required, string): Long token for strategy A
- `strategyA.shortToken` (required, string): Short token for strategy A
- `strategyB.longToken` (required, string): Long token for strategy B
- `strategyB.shortToken` (required, string): Short token for strategy B
- `timePeriod` (optional, number): Analysis period in days (default: 100)

**Example:**
```bash
curl -X POST {baseUrl}/api/delta-neutral \
  -H "Content-Type: application/json" \
  -d '{
    "strategyA": {
      "longToken": "BTCUSDT",
      "shortToken": "ETHUSDT"
    },
    "strategyB": {
      "longToken": "LINKUSDT",
      "shortToken": "SOLUSDT"
    },
    "timePeriod": 100
  }'
```

---

### POST /liquidity-range

Analyzes liquidity range for a token pair.

**Request Body:**
```json
{
  "tokenA": "BTCUSDT",
  "tokenB": "ETHUSDT",
  "rangeUpPercent": 5,
  "rangeDownPercent": 5,
  "timePeriod": 100
}
```

**Parameters:**
- `tokenA` (required, string): First token symbol
- `tokenB` (required, string): Second token symbol
- `rangeUpPercent` (required, number): Upper range percentage
- `rangeDownPercent` (required, number): Lower range percentage
- `timePeriod` (optional, number): Analysis period in days (default: 100)

**Example:**
```bash
curl -X POST {baseUrl}/api/liquidity-range \
  -H "Content-Type: application/json" \
  -d '{
    "tokenA": "BTCUSDT",
    "tokenB": "ETHUSDT",
    "rangeUpPercent": 5,
    "rangeDownPercent": 5,
    "timePeriod": 100
  }'
```

---

### GET /tokens

Returns the list of available trading tokens with their market cap categories.

**Response:**
```json
[
  {
    "symbol": "BTCUSDT",
    "marketCapCategory": "H"
  },
  {
    "symbol": "ETHUSDT",
    "marketCapCategory": "H"
  },
  {
    "symbol": "LINKUSDT",
    "marketCapCategory": "M"
  },
  ...
]
```

**Example:**
```bash
curl -X GET {baseUrl}/api/tokens
```

---

### GET /long-short-history

Retrieves historical price ratio data between two tokens.

**Query Parameters:**
- `longToken` (required, string): Long position token
- `shortToken` (required, string): Short position token
- `timePeriod` (optional, number): Period in days (default: 100)

**Response:**
```json
{
  "success": true,
  "symbol": "BTCUSDT/ETHUSDT",
  "longToken": "BTCUSDT",
  "shortToken": "ETHUSDT",
  "data": [...],
  "count": 100
}
```

**Example:**
```bash
curl -X GET "{baseUrl}/api/long-short-history?longToken=BTCUSDT&shortToken=ETHUSDT&timePeriod=100"
```

---

### GET /strategy-bundles

Retrieves analyzed strategy bundles with filtering and sorting options.

**Query Parameters:**
- `limit` (optional, number): Number of results to return (default: 15)
- `riskLevel` (optional, string): Risk level filter - `LOW`, `MEDIUM`, `HIGH`, `ALL` (default: `ALL`)
- `timePeriod` (optional, string): Time period filter - `30d`, `60d`, `100d`, `ALL` (default: `ALL`)
- `sortBy` (optional, string): Sort field - `APR`, `WIN_RATE`, `SHARPE_RATIO`, `CONSISTENCY` (default: `APR`)
- `strategyType` (optional, string): Strategy type - `BTC_ETH`, `MAJOR` (default: `MAJOR`)

**Response:**
```json
{
  "strategies": [...],
  "totalAnalyzed": 150,
  "totalFiltered": 45,
  "returned": 15,
  "strategyType": "MAJOR",
  "cacheInfo": {
    "cached": false,
    "generatedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

**Example:**
```bash
curl -X GET "{baseUrl}/api/strategy-bundles?limit=15&riskLevel=ALL&timePeriod=ALL&sortBy=APR&strategyType=MAJOR"
```

---

### GET /cache-stats

Returns cache statistics for strategy bundles.

**Response:**
```json
{
  "totalEntries": 10,
  "validEntries": 8,
  "expiredEntries": 2,
  "ttl": 3600000,
  "ttlHours": 1
}
```

**Example:**
```bash
curl -X GET {baseUrl}/api/cache-stats
```

---

### GET /contract-senders

Retrieves unique message senders for a contract on Arbitrum network.

**Query Parameters:**
- `fromBlock` (optional, number): Starting block number (default: 0)
- `toBlock` (optional, number): Ending block number (default: 99999999)
- `maxTxs` (optional, number): Maximum transactions to process (default: unlimited)

**Response:**
```json
{
  "success": true,
  "contractAddress": "0xF201797e767872541a8149A4906FF73615189646",
  "network": "Arbitrum",
  "fromBlock": 0,
  "toBlock": 99999999,
  "totalTxsProcessed": 1500,
  "totalUniqueSenders": 450,
  "senders": [...],
  "pagesProcessed": 15
}
```

**Example:**
```bash
curl -X GET "{baseUrl}/api/contract-senders?fromBlock=0&toBlock=99999999&maxTxs=1000"
```

---

## Error Responses

All endpoints return standard HTTP status codes:

- `200 OK`: Successful request
- `400 Bad Request`: Invalid parameters
- `500 Internal Server Error`: Server error

Error response format:
```json
{
  "error": "Error message",
  "details": "Additional error details"
}
```

## Response Format

All successful responses return JSON. Token symbols must be in the format `{TOKEN}USDT` (e.g., `BTCUSDT`, `ETHUSDT`).

## Rate Limiting

Currently, no rate limiting is implemented. Use responsibly.

## Data Sources

Price data is sourced from the Hyperliquid candle API (`https://api.hyperliquid.xyz/info`, `candleSnapshot`). Binance klines are only used when Hyperliquid has no candles for that coin.

<!--
  █████████                                   █████                          
 ███▒▒▒▒▒███                                 ▒▒███                           
▒███    ▒▒▒      ██████     ████████       ███████     ████████      ██████  
▒▒█████████     ███▒▒███   ▒▒███▒▒███     ███▒▒███    ▒▒███▒▒███    ▒▒▒▒▒███ 
 ▒▒▒▒▒▒▒▒███   ▒███████     ▒███ ▒███    ▒███ ▒███     ▒███ ▒▒▒      ███████ 
 ███    ▒███   ▒███▒▒▒      ▒███ ▒███    ▒███ ▒███     ▒███         ███▒▒███ 
▒▒█████████    ▒▒██████     ████ █████   ▒▒████████    █████       ▒▒████████
 ▒▒▒▒▒▒▒▒▒      ▒▒▒▒▒▒     ▒▒▒▒ ▒▒▒▒▒     ▒▒▒▒▒▒▒▒    ▒▒▒▒▒         ▒▒▒▒▒▒▒▒ 
                                                                             
 █████                 █████            
▒▒███                 ▒▒███             
 ▒███         ██████   ▒███████   █████ 
 ▒███        ▒▒▒▒▒███  ▒███▒▒███ ███▒▒  
 ▒███         ███████  ▒███ ▒███▒▒█████ 
 ▒███      █ ███▒▒███  ▒███ ▒███ ▒▒▒▒███
 ███████████▒▒████████ ████████  ██████ 
▒▒▒▒▒▒▒▒▒▒▒  ▒▒▒▒▒▒▒▒ ▒▒▒▒▒▒▒▒  ▒▒▒▒▒▒  
```
