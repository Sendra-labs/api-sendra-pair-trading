const express = require('express');
const cors = require('cors');
const axios = require('axios');

console.log('Market-Neutral Intelligence Engine');
const app = express();
const PORT = 3001;

class StrategyCache {
  constructor() {
    this.cache = new Map();
    this.TTL = 3600000;
  }

  generateKey(params = {}) {
    const { limit = 15, riskLevel = 'ALL', timePeriod = 'ALL', sortBy = 'APR', strategyType = 'MAJOR' } = params;
    return `strategy-bundles-${limit}-${riskLevel}-${timePeriod}-${sortBy}-${strategyType}`;
  }

  isValid(entry) {
    if (!entry) return false;
    const now = Date.now();
    return (now - entry.timestamp) < this.TTL;
  }

  get(params) {
    const key = this.generateKey(params);
    const entry = this.cache.get(key);
    
    if (this.isValid(entry)) {
      return {
        ...entry.data,
        cached: true,
        cacheAge: Date.now() - entry.timestamp,
        cacheExpiresIn: this.TTL - (Date.now() - entry.timestamp)
      };
    }
    
    if (entry) {
      this.cache.delete(key);
    }
    
    return null;
  }

  set(params, data) {
    const key = this.generateKey(params);
    const entry = {
      data,
      timestamp: Date.now()
    };
    
    this.cache.set(key, entry);
    
    this.cleanup();
  }

  cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if ((now - entry.timestamp) >= this.TTL) {
        this.cache.delete(key);
      }
    }
  }

  getStats() {
    const now = Date.now();
    const stats = {
      totalEntries: this.cache.size,
      validEntries: 0,
      expiredEntries: 0,
      oldestEntry: null,
      newestEntry: null
    };

    for (const [key, entry] of this.cache.entries()) {
      if (this.isValid(entry)) {
        stats.validEntries++;
      } else {
        stats.expiredEntries++;
      }

      if (!stats.oldestEntry || entry.timestamp < stats.oldestEntry.timestamp) {
        stats.oldestEntry = { key, timestamp: entry.timestamp };
      }
      if (!stats.newestEntry || entry.timestamp > stats.newestEntry.timestamp) {
        stats.newestEntry = { key, timestamp: entry.timestamp };
      }
    }

    return stats;
  }
}

const strategyCache = new StrategyCache();

function calculateOverallScore(metrics) {
  const periods = Object.keys(metrics);
  if (periods.length === 0) return 0;

  const periodWeights = {
    '30d': 0.50,
    '60d': 0.30,
    '100d': 0.20
  };

  let weightedScore = 0;
  let totalWeight = 0;

  for (const period of periods) {
    const metric = metrics[period];
    const weight = periodWeights[period] || 0;
    
    if (metric && metric.validDays >= 30 && weight > 0) {
      const winRateScore = Math.min(metric.winRate, 100) * 0.3;
      const profitScore = Math.max(0, Math.min(metric.totalProfit, 200)) * 0.25;
      const sharpeScore = Math.max(0, Math.min(metric.sharpeRatio * 10, 20)) * 0.2;
      const consistencyScore = Math.min(metric.consistencyScore, 100) * 0.15;
      
      let recommendationScore = 0;
      switch (metric.recommendation) {
        case 'STRONG_BUY': recommendationScore = 10; break;
        case 'BUY': recommendationScore = 7; break;
        case 'HOLD': recommendationScore = 4; break;
        case 'SELL': recommendationScore = 0; break;
      }
      recommendationScore *= 0.1;

      const periodScore = winRateScore + profitScore + sharpeScore + consistencyScore + recommendationScore;
      weightedScore += periodScore * weight;
      totalWeight += weight;
    }
  }

  return totalWeight > 0 ? weightedScore / totalWeight : 0;
}

function determineRiskLevel(metrics) {
  const periods = Object.keys(metrics);
  if (periods.length === 0) return 'HIGH';

  const m30d = metrics['30d'];
  const m60d = metrics['60d'];
  const m100d = metrics['100d'];

  const has30d = m30d && m30d.validDays >= 25;
  const has60d = m60d && m60d.validDays >= 50;
  const has100d = m100d && m100d.validDays >= 80;

  if (!has30d && !has60d && !has100d) return 'HIGH';

  const isLowRisk30d = has30d && m30d.winRate >= 58 && m30d.totalProfit >= 10 && m30d.sharpeRatio >= 0.05;
  const isLowRisk60d = has60d && m60d.winRate >= 55 && m60d.totalProfit >= 15;
  const isLowRisk100d = has100d && m100d.winRate >= 50 && m100d.totalProfit >= 20;

  const isMediumRisk30d = has30d && m30d.winRate >= 52 && m30d.totalProfit >= 5;
  const isMediumRisk60d = has60d && m60d.winRate >= 50 && m60d.totalProfit >= 8;
  const isMediumRisk100d = has100d && m100d.winRate >= 48;

  if (isLowRisk30d && (isLowRisk60d || isLowRisk100d)) {
    return 'LOW';
  }

  if (isMediumRisk30d && (isMediumRisk60d || isMediumRisk100d)) {
    return 'MEDIUM';
  }

  if (isLowRisk30d) {
    return 'MEDIUM';
  }

  return 'HIGH';
}

function getBestRecommendation(metrics) {
  const periods = Object.keys(metrics);
  if (periods.length === 0) return 'HOLD';

  const m30d = metrics['30d'];
  const m60d = metrics['60d'];
  const m100d = metrics['100d'];

  if (m30d && m30d.validDays >= 25 && m30d.recommendation === 'STRONG_BUY') {
    const othersFavorable = 
      (m60d && (m60d.recommendation === 'STRONG_BUY' || m60d.recommendation === 'BUY' || m60d.recommendation === 'HOLD')) ||
      (m100d && (m100d.recommendation === 'STRONG_BUY' || m100d.recommendation === 'BUY' || m100d.recommendation === 'HOLD'));
    
    if (othersFavorable) return 'STRONG_BUY';
    return 'BUY';
  }

  if (m30d && m30d.validDays >= 25 && m30d.recommendation === 'BUY') {
    const othersBuy = 
      (m60d && (m60d.recommendation === 'STRONG_BUY' || m60d.recommendation === 'BUY')) ||
      (m100d && (m100d.recommendation === 'STRONG_BUY' || m100d.recommendation === 'BUY'));
    
    if (othersBuy) return 'BUY';
  }

  let strongBuyCount = 0;
  let buyCount = 0;

  for (const period of periods) {
    const metric = metrics[period];
    if (metric && metric.validDays >= 30) {
      if (metric.recommendation === 'STRONG_BUY') strongBuyCount++;
      if (metric.recommendation === 'BUY') buyCount++;
    }
  }

  if (strongBuyCount >= 2) return 'STRONG_BUY';
  if (buyCount >= 2 || (buyCount >= 1 && strongBuyCount >= 1)) return 'BUY';
  return 'HOLD';
}

function getAverageConfidence(metrics) {
  const periods = Object.keys(metrics);
  if (periods.length === 0) return 0;

  let totalConfidence = 0;
  let validPeriods = 0;

  for (const period of periods) {
    const metric = metrics[period];
    if (metric && metric.validDays >= 30) {
      totalConfidence += metric.confidence;
      validPeriods++;
    }
  }

  return validPeriods > 0 ? totalConfidence / validPeriods : 0;
}

function calculateAPR(metrics) {
  const periods = Object.keys(metrics);
  if (periods.length === 0) return 0;

  const periodPriority = ['100d', '60d', '30d'];
  
  for (const period of periodPriority) {
    const metric = metrics[period];
    if (metric && metric.validDays >= 30) {
      const days = metric.validDays;
      const totalProfitFromPrices = metric.totalProfitFromPrices !== undefined ? metric.totalProfitFromPrices : metric.totalProfit;
      
      if (days === 0) return 0;
      
      const apr = (totalProfitFromPrices / days) * 365;
      
      return Math.round(apr * 10) / 10;
    }
  }

  return 0;
}

function generateSimulatedTVL(pair, score) {
  const baseTVL = Math.max(1, Math.min(50, score * 2));
  const randomFactor = 0.8 + Math.random() * 0.4;
  return Math.round(baseTVL * randomFactor * 100) / 100;
}

function getBestWinRate(metrics) {
  const periods = Object.keys(metrics);
  let bestWinRate = 0;
  
  for (const period of periods) {
    const metric = metrics[period];
    if (metric && metric.validDays >= 30) {
      bestWinRate = Math.max(bestWinRate, metric.winRate);
    }
  }
  
  return bestWinRate;
}

function getBestSharpeRatio(metrics) {
  const periods = Object.keys(metrics);
  let bestSharpe = 0;
  
  for (const period of periods) {
    const metric = metrics[period];
    if (metric && metric.validDays >= 30) {
      bestSharpe = Math.max(bestSharpe, metric.sharpeRatio);
    }
  }
  
  return bestSharpe;
}

function getBestConsistency(metrics) {
  const periods = Object.keys(metrics);
  let bestConsistency = 0;
  
  for (const period of periods) {
    const metric = metrics[period];
    if (metric && metric.validDays >= 30) {
      bestConsistency = Math.max(bestConsistency, metric.consistencyScore);
    }
  }
  
  return bestConsistency;
}

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: false
}));
app.use(express.json());

app.options('*', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.sendStatus(200);
});


const { BinanceService } = require('./dist/binanceService');
const { LongShortAnalyzer } = require('./dist/longShortAnalyzer');
const { fetchFundingFees, getFundingFeesForStrategy } = require('./dist/fundingFeesService');
const { DeltaNeutralAnalyzer } = require('./dist/deltaNeutralAnalyzer');
const { LiquidityRangeAnalyzer } = require('./dist/liquidityRangeAnalyzer');
const { getConfig } = require('./dist/config');

const MARKET_CAP_CATEGORIES = {
  'BTCUSDT': 'H',
  'ETHUSDT': 'H',
  'LINKUSDT': 'M',
  'SOLUSDT': 'H',
  'DOTUSDT': 'L',
  'AVAXUSDT': 'M',
  'BNBUSDT': 'H',
  'DOGEUSDT': 'M',
  'PEPEUSDT': 'L',
  'WIFUSDT': 'SUPERL',
  'PENDLEUSDT': 'SUPERL',
  'ARBUSDT': 'L',
  'OPUSDT': 'L',
  'APEUSDT': 'SUPERL',
  'GMXUSDT': 'SUPERL',
  'HYPEUSDT': 'H',
  'AAVEUSDT': 'L',
  'UNIUSDT': 'L',
  'ADAUSDT': 'M',
  'TAOUSDT': 'L',
  'ATOMUSDT': 'L',
  'LDOUSDT': 'SUPERL',
  'NEARUSDT': 'L',
  'TIAUSDT': 'L',
  'CAKEUSDT': 'L',
  'ZROUSDT': 'L',
  'TRUMPUSDT': 'L',
  'APTUSDT': 'L',
  'INJUSDT': 'L',
  'CRVUSDT': 'L',
  'XRPUSDT': 'H',
  'DYDXUSDT': 'SUPERL',
  'SUIUSDT': 'L',
  'XLMUSDT': 'M'
};

function getMarketCapAlignment(longToken, shortToken) {
  const longCap = MARKET_CAP_CATEGORIES[longToken.toUpperCase()] || 'L';
  const shortCap = MARKET_CAP_CATEGORIES[shortToken.toUpperCase()] || 'L';
  
  const alignmentMatrix = {
    'H-H': { level: 'HIGH', score: 100, description: 'Both tokens are high market cap, similar volatility expected' },
    'H-M': { level: 'MEDIUM', score: 70, description: 'High and medium market cap, moderate volatility difference' },
    'H-L': { level: 'LOW', score: 40, description: 'High and low market cap, significant volatility difference' },
    'H-SUPERL': { level: 'VERY_LOW', score: 20, description: 'High and very low market cap, extreme volatility difference' },
    'M-M': { level: 'HIGH', score: 100, description: 'Both tokens are medium market cap, similar volatility expected' },
    'M-L': { level: 'MEDIUM', score: 60, description: 'Medium and low market cap, moderate volatility difference' },
    'M-SUPERL': { level: 'LOW', score: 30, description: 'Medium and very low market cap, significant volatility difference' },
    'L-L': { level: 'HIGH', score: 100, description: 'Both tokens are low market cap, similar volatility expected' },
    'L-SUPERL': { level: 'MEDIUM', score: 50, description: 'Low and very low market cap, moderate volatility difference' },
    'SUPERL-SUPERL': { level: 'HIGH', score: 100, description: 'Both tokens are very low market cap, similar volatility expected' }
  };
  
  const key = `${longCap}-${shortCap}`;
  const reverseKey = `${shortCap}-${longCap}`;
  
  const result = alignmentMatrix[key] || alignmentMatrix[reverseKey] || { 
    level: 'UNKNOWN', 
    score: 0, 
    description: 'Market cap categories not found' 
  };
  
  return {
    ...result,
    longTokenCategory: longCap,
    shortTokenCategory: shortCap
  };
}

app.post('/api/analyze', async (req, res) => {
  try {
    const { longToken, shortToken, timePeriod } = req.body;
    
    if (!longToken || !shortToken) {
      return res.status(400).json({ 
        error: 'longToken and shortToken are required' 
      });
    }

    if (longToken === shortToken) {
      return res.status(400).json({ 
        error: 'Long and Short tokens must be different' 
      });
    }

    const binanceService = new BinanceService(
      'https://api.binance.com/api/v3/klines',
      '1d',
      timePeriod || 100
    );
    
    const longShortAnalyzer = new LongShortAnalyzer();

    const longTokenData = await binanceService.getKlines(longToken.toUpperCase());
    const shortTokenData = await binanceService.getKlines(shortToken.toUpperCase());

    if (!longTokenData.success || !shortTokenData.success) {
      return res.status(500).json({ 
        error: 'Error fetching data from Binance',
        details: longTokenData.error || shortTokenData.error
      });
    }

    const longKlines = binanceService.processKlines(longTokenData.data);
    const shortKlines = binanceService.processKlines(shortTokenData.data);

    if (!binanceService.validateKlines(longKlines) || !binanceService.validateKlines(shortKlines)) {
      return res.status(500).json({ 
        error: 'Invalid data received from Binance' 
      });
    }

    const filteredLongKlines = binanceService.filterValidDays(longKlines);
    const filteredShortKlines = binanceService.filterValidDays(shortKlines);

    const { synchronizedA, synchronizedB } = binanceService.synchronizeTimestamps(
      filteredLongKlines, 
      filteredShortKlines
    );

    if (synchronizedA.length < 30) {
      return res.status(500).json({ 
        error: `Insufficient valid data: ${synchronizedA.length} days (minimum: 30)` 
      });
    }

    let fundingMap = new Map();
    try {
      fundingMap = await fetchFundingFees();
    } catch (err) {
    }
    const { fundingFeeLong, fundingFeeShort } = getFundingFeesForStrategy(
      fundingMap,
      longToken,
      shortToken
    );

    const stats = longShortAnalyzer.analyzeLongShortStrategy(
      longToken.toUpperCase(),
      shortToken.toUpperCase(),
      synchronizedA,
      synchronizedB,
      { fundingFeeLong, fundingFeeShort }
    );

    const result = longShortAnalyzer.generateRecommendation(stats);
    
    const marketCapAlignment = getMarketCapAlignment(longToken, shortToken);
    
    const { sharpeRatio, consistencyScore, recommendation, ...statsFiltered } = stats;
    const { recommendation: rec, confidence, ...resultFiltered } = result;
    
    const response = {
      pair: resultFiltered.pair,
      stats: statsFiltered,
      marketCapAlignment: {
        level: marketCapAlignment.level,
        score: marketCapAlignment.score,
        description: marketCapAlignment.description,
        longTokenCategory: marketCapAlignment.longTokenCategory,
        shortTokenCategory: marketCapAlignment.shortTokenCategory
      }
    };

    res.json(response);

  } catch (error) {
    res.status(500).json({ 
      error: 'Internal server error',
      details: error.message 
    });
  }
});

app.post('/api/delta-neutral', async (req, res) => {
  try {
    const { 
      strategyA: { longToken: longTokenA, shortToken: shortTokenA },
      strategyB: { longToken: longTokenB, shortToken: shortTokenB },
      timePeriod 
    } = req.body;
    
    if (!longTokenA || !shortTokenA || !longTokenB || !shortTokenB) {
      return res.status(400).json({ 
        error: 'All tokens are required for both strategies' 
      });
    }

    const analyzer = new DeltaNeutralAnalyzer();
    const result = await analyzer.analyzeDeltaNeutral(
      { longToken: longTokenA, shortToken: shortTokenA },
      { longToken: longTokenB, shortToken: shortTokenB },
      timePeriod || 100
    );

    res.json(result);

  } catch (error) {
    res.status(500).json({ 
      error: 'Internal server error',
      details: error.message 
    });
  }
});

app.post('/api/liquidity-range', async (req, res) => {
  try {
    const { tokenA, tokenB, rangeUpPercent, rangeDownPercent, timePeriod } = req.body;
    
    if (!tokenA || !tokenB) {
      return res.status(400).json({ 
        error: 'tokenA and tokenB are required' 
      });
    }

    if (tokenA === tokenB) {
      return res.status(400).json({ 
        error: 'Tokens must be different' 
      });
    }

    if (!rangeUpPercent || !rangeDownPercent || rangeUpPercent <= 0 || rangeDownPercent <= 0) {
      return res.status(400).json({ 
        error: 'Range percentages must be positive' 
      });
    }

    const binanceService = new BinanceService(
      'https://api.binance.com/api/v3/klines',
      '1d',
      timePeriod || 100
    );
    
    const liquidityRangeAnalyzer = new LiquidityRangeAnalyzer();

    const tokenAData = await binanceService.getKlines(tokenA.toUpperCase());
    const tokenBData = await binanceService.getKlines(tokenB.toUpperCase());

    if (!tokenAData.success || !tokenBData.success) {
      return res.status(500).json({ 
        error: 'Error fetching data from Binance',
        details: tokenAData.error || tokenBData.error
      });
    }

    const klinesA = binanceService.processKlines(tokenAData.data);
    const klinesB = binanceService.processKlines(tokenBData.data);

    if (!binanceService.validateKlines(klinesA) || !binanceService.validateKlines(klinesB)) {
      return res.status(500).json({ 
        error: 'Invalid data received from Binance' 
      });
    }

    const filteredKlinesA = binanceService.filterValidDays(klinesA);
    const filteredKlinesB = binanceService.filterValidDays(klinesB);

    const { synchronizedA, synchronizedB } = binanceService.synchronizeTimestamps(
      filteredKlinesA, 
      filteredKlinesB
    );

    if (synchronizedA.length < 30) {
      return res.status(500).json({ 
        error: `Insufficient valid data: ${synchronizedA.length} days (minimum: 30)` 
      });
    }

    const result = liquidityRangeAnalyzer.analyzeLiquidityRange(
      tokenA.toUpperCase(),
      tokenB.toUpperCase(),
      synchronizedA,
      synchronizedB,
      rangeUpPercent,
      rangeDownPercent
    );

    res.json(result);

  } catch (error) {
    res.status(500).json({ 
      error: 'Internal server error',
      details: error.message 
    });
  }
});

app.get('/api/tokens', (req, res) => {
  const tokens = Object.keys(MARKET_CAP_CATEGORIES).map(token => ({
    symbol: token,
    marketCapCategory: MARKET_CAP_CATEGORIES[token]
  }));
  
  res.json(tokens);
});

app.get('/api/long-short-history', async (req, res) => {
  try {
    const { longToken, shortToken, timePeriod = 100 } = req.query;
    
    if (!longToken || !shortToken) {
      return res.status(400).json({ 
        error: 'longToken and shortToken are required as query parameters' 
      });
    }

    if (longToken === shortToken) {
      return res.status(400).json({ 
        error: 'Long and Short tokens must be different' 
      });
    }

    const binanceService = new BinanceService(
      'https://api.binance.com/api/v3/klines',
      '1d',
      parseInt(timePeriod) || 100
    );
    
    const longTokenUpper = longToken.toUpperCase();
    const shortTokenUpper = shortToken.toUpperCase();
    
    const longTokenSymbol = longTokenUpper.endsWith('USDT') ? longTokenUpper : `${longTokenUpper}USDT`;
    const shortTokenSymbol = shortTokenUpper.endsWith('USDT') ? shortTokenUpper : `${shortTokenUpper}USDT`;

    const longTokenData = await binanceService.getKlines(longTokenSymbol);
    const shortTokenData = await binanceService.getKlines(shortTokenSymbol);

    if (!longTokenData.success || !shortTokenData.success) {
      return res.status(500).json({ 
        error: 'Error fetching data from Binance',
        details: longTokenData.error || shortTokenData.error
      });
    }

    const longKlines = binanceService.processKlines(longTokenData.data);
    const shortKlines = binanceService.processKlines(shortTokenData.data);

    if (!binanceService.validateKlines(longKlines) || !binanceService.validateKlines(shortKlines)) {
      return res.status(500).json({ 
        error: 'Invalid data received from Binance' 
      });
    }

    const filteredLongKlines = binanceService.filterValidDays(longKlines);
    const filteredShortKlines = binanceService.filterValidDays(shortKlines);

    const { synchronizedA, synchronizedB } = binanceService.synchronizeTimestamps(
      filteredLongKlines, 
      filteredShortKlines
    );

    if (synchronizedA.length === 0) {
      return res.status(500).json({ 
        error: 'No synchronized data found between tokens' 
      });
    }

    const ratioKlines = synchronizedA.map((longKline, index) => {
      const shortKline = synchronizedB[index];
      
      const openRatio = shortKline.open !== 0 ? (longKline.open / shortKline.open) : 0;
      const highRatio = shortKline.high !== 0 ? (longKline.high / shortKline.high) : 0;
      const lowRatio = shortKline.low !== 0 ? (longKline.low / shortKline.low) : 0;
      const closeRatio = shortKline.close !== 0 ? (longKline.close / shortKline.close) : 0;
      const volumeRatio = (longKline.volume + shortKline.volume) / 2;
      
      const ratioKline = [
        longKline.timestamp,
        openRatio.toFixed(8),
        highRatio.toFixed(8),
        lowRatio.toFixed(8),
        closeRatio.toFixed(8),
        volumeRatio.toFixed(8),
        longKline.timestamp + 86400000 - 1,
        volumeRatio.toFixed(8),
        0,
        (volumeRatio * 0.5).toFixed(8),
        (volumeRatio * 0.5).toFixed(8),
        '0'
      ];
      
      return ratioKline;
    });

    res.json({
      success: true,
      symbol: `${longTokenSymbol}/${shortTokenSymbol}`,
      longToken: longTokenSymbol,
      shortToken: shortTokenSymbol,
      data: ratioKlines,
      count: ratioKlines.length
    });

  } catch (error) {
    res.status(500).json({ 
      error: 'Internal server error',
      details: error.message 
    });
  }
});

app.get('/api/strategy-bundles', async (req, res) => {
  try {
    const { 
      limit = 15, 
      riskLevel = 'ALL', 
      timePeriod = 'ALL', 
      sortBy = 'APR',
      strategyType = 'MAJOR'
    } = req.query;

    const cacheParams = { limit: parseInt(limit), riskLevel, timePeriod, sortBy, strategyType };
    const cachedResult = strategyCache.get(cacheParams);
    
    if (cachedResult) {
      return res.json(cachedResult);
    }

    const availableTokens = [
      'BTCUSDT', 'ETHUSDT', 'LINKUSDT', 'SOLUSDT', 'DOTUSDT', 'AVAXUSDT',
      'BNBUSDT', 'DOGEUSDT', 'PEPEUSDT', 'WIFUSDT', 'PENDLEUSDT', 'ARBUSDT',
      'OPUSDT', 'APEUSDT', 'GMXUSDT', 'AAVEUSDT', 'UNIUSDT', 'ADAUSDT',
      'TAOUSDT', 'ATOMUSDT', 'LDOUSDT', 'NEARUSDT', 'TIAUSDT', 'CAKEUSDT',
      'ZROUSDT', 'TRUMPUSDT'
    ];

    const systematicPairs = [];
    
    const longTokens = ['BTCUSDT', 'ETHUSDT', 'LINKUSDT', 'SOLUSDT', 'BNBUSDT', 'HYPEUSDT'];
    
    let targetLongTokens = [];
    let targetShortTokens = [];
    
    if (strategyType === 'BTC_ETH') {
      targetLongTokens = ['BTCUSDT', 'ETHUSDT'];
      targetShortTokens = availableTokens;
    } else if (strategyType === 'MAJOR') {
      targetLongTokens = longTokens;
      targetShortTokens = availableTokens;
    } else {
      targetLongTokens = longTokens;
      targetShortTokens = availableTokens;
    }
    
    for (const longToken of targetLongTokens) {
      for (const token of targetShortTokens) {
        if (token !== longToken) {
          systematicPairs.push({ longToken: longToken, shortToken: token });
        }
      }
    }

    const tokenDataCache = new Map();
    const timePeriods = [30, 60, 100];
    const analysisResults = [];

    let fundingMap = new Map();
    try {
      fundingMap = await fetchFundingFees();
    } catch (err) {
      // Continuar sin funding fees si el API falla
    }

    async function getTokenData(token, period) {
      const cacheKey = `${token}-${period}`;
      
      if (tokenDataCache.has(cacheKey)) {
        return tokenDataCache.get(cacheKey);
      }

      const binanceService = new BinanceService(
        'https://api.binance.com/api/v3/klines',
        '1d',
        period
      );

      const tokenData = await binanceService.getKlines(token);
      
      if (tokenData.success) {
        const processedData = binanceService.processKlines(tokenData.data);
        const filteredData = binanceService.filterValidDays(processedData);
        
        const result = {
          success: true,
          data: filteredData,
          binanceService
        };
        
        tokenDataCache.set(cacheKey, result);
        return result;
      } else {
        return { success: false, error: tokenData.error };
      }
    }

    for (const pair of systematicPairs) {
      try {
        const { fundingFeeLong, fundingFeeShort } = getFundingFeesForStrategy(
          fundingMap,
          pair.longToken,
          pair.shortToken
        );
        const pairResults = {
          pair: `${pair.longToken}/${pair.shortToken}`,
          longToken: pair.longToken,
          shortToken: pair.shortToken,
          metrics: {},
          riskLevel: 'MEDIUM',
          fundingFeeLong: fundingFeeLong,
          fundingFeeShort: fundingFeeShort
        };

        for (const period of timePeriods) {
          try {
            const longTokenData = await getTokenData(pair.longToken, period);
            const shortTokenData = await getTokenData(pair.shortToken, period);

            if (longTokenData.success && shortTokenData.success) {
              const longShortAnalyzer = new LongShortAnalyzer();

              const { synchronizedA, synchronizedB } = longTokenData.binanceService.synchronizeTimestamps(
                longTokenData.data, 
                shortTokenData.data
              );

              if (synchronizedA.length >= 30) {
                const stats = longShortAnalyzer.analyzeLongShortStrategy(
                  pair.longToken,
                  pair.shortToken,
                  synchronizedA,
                  synchronizedB,
                  { fundingFeeLong, fundingFeeShort }
                );

                const result = longShortAnalyzer.generateRecommendation(stats);

                pairResults.metrics[`${period}d`] = {
                  winRate: stats.winRate,
                  totalProfit: stats.totalProfit,
                  totalProfitFromPrices: stats.totalProfitFromPrices,
                  averageDailyProfit: stats.averageDailyProfit,
                  validDays: stats.validDays
                };
              }
            }
          } catch (error) {
          }
        }

        if (Object.keys(pairResults.metrics).length > 0) {
          pairResults.riskLevel = determineRiskLevel(pairResults.metrics);
          
          analysisResults.push(pairResults);
        }

      } catch (error) {
      }
    }

    let filteredResults = analysisResults;

    if (riskLevel !== 'ALL') {
      filteredResults = filteredResults.filter(result => result.riskLevel === riskLevel);
    }

    filteredResults.sort((a, b) => {
      switch (sortBy) {
        case 'APR':
          return calculateAPR(b.metrics) - calculateAPR(a.metrics);
        case 'WIN_RATE':
          return getBestWinRate(b.metrics) - getBestWinRate(a.metrics);
        case 'SHARPE_RATIO':
          return getBestSharpeRatio(b.metrics) - getBestSharpeRatio(a.metrics);
        case 'CONSISTENCY':
          return getBestConsistency(b.metrics) - getBestConsistency(a.metrics);
        default:
          return calculateAPR(b.metrics) - calculateAPR(a.metrics);
      }
    });

    const finalResults = filteredResults.slice(0, parseInt(limit));

    async function getPairValues(longToken, shortToken) {
      try {
        const binanceService = new BinanceService(
          'https://api.binance.com/api/v3/klines',
          '1d',
          100
        );

        const longTokenData = await binanceService.getKlines(longToken);
        const shortTokenData = await binanceService.getKlines(shortToken);

        if (!longTokenData.success || !shortTokenData.success) {
          return [];
        }

        const longKlines = binanceService.processKlines(longTokenData.data);
        const shortKlines = binanceService.processKlines(shortTokenData.data);

        if (!binanceService.validateKlines(longKlines) || !binanceService.validateKlines(shortKlines)) {
          return [];
        }

        const filteredLongKlines = binanceService.filterValidDays(longKlines);
        const filteredShortKlines = binanceService.filterValidDays(shortKlines);

        const { synchronizedA, synchronizedB } = binanceService.synchronizeTimestamps(
          filteredLongKlines,
          filteredShortKlines
        );

        const values = synchronizedA.map((longKline, index) => {
          const shortKline = synchronizedB[index];
          if (shortKline.close !== 0) {
            return parseFloat((longKline.close / shortKline.close).toFixed(8));
          }
          return 0;
        }).filter(v => v !== 0);

        if (values.length > 0 && values.length < 100) {
          const firstValue = values[0];
          while (values.length < 100) {
            values.unshift(firstValue);
          }
        }

        return values.slice(-100);
      } catch (error) {
        return [];
      }
    }

    function extractTokenSymbol(token) {
      return token.replace('USDT', '');
    }

    const resultsWithAPRAndValues = await Promise.all(
      finalResults.map(async (result) => {
        const values = await getPairValues(result.longToken, result.shortToken);
        
        return {
          pair: result.pair,
          longToken: extractTokenSymbol(result.longToken),
          shortToken: extractTokenSymbol(result.shortToken),
          metrics: result.metrics,
          riskLevel: result.riskLevel,
          fundingFeeLong: result.fundingFeeLong,
          fundingFeeShort: result.fundingFeeShort,
          apr: calculateAPR(result.metrics),
          winRate100d: result.metrics['100d']?.winRate || 0,
          avgDailyProfit100d: result.metrics['100d']?.averageDailyProfit || 0,
          totalProfit100d: result.metrics['100d']?.totalProfit || 0,
          values: values
        };
      })
    );

    const resultsWithAPR = resultsWithAPRAndValues;

    const response = {
      strategies: resultsWithAPR,
      totalAnalyzed: systematicPairs.length,
      totalFiltered: filteredResults.length,
      returned: resultsWithAPR.length,
      strategyType: strategyType,
      strategyInfo: {
        type: strategyType,
        description: strategyType === 'BTC_ETH' 
          ? 'Analysis focused on BTC and ETH only' 
          : 'Analysis with all major tokens',
        longTokens: targetLongTokens,
        shortTokens: targetShortTokens.slice(0, 5)
      },
      cacheInfo: {
        cached: false,
        generatedAt: new Date().toISOString()
      }
    };

    strategyCache.set(cacheParams, response);

    res.json(response);

  } catch (error) {
    res.status(500).json({ 
      error: 'Error generating strategy bundles',
      details: error.message 
    });
  }
});

app.get('/api/cache-stats', (req, res) => {
  const stats = strategyCache.getStats();
  res.json({
    ...stats,
    ttl: strategyCache.TTL,
    ttlHours: strategyCache.TTL / (1000 * 60 * 60)
  });
});

app.get('/api/contract-senders', async (req, res) => {
  try {
    const contractAddress = '0xF201797e767872541a8149A4906FF73615189646';
    const apiKey = 'GGBW6DZQN28DS8PFKNJRE7FP47DCCIA3J6';
    const apiUrl = 'https://api.etherscan.io/v2/api';
    const chainId = 42161;
    
    const fromBlock = req.query.fromBlock ? parseInt(req.query.fromBlock) : 0;
    const toBlock = req.query.toBlock ? parseInt(req.query.toBlock) : 99999999;
    const maxTxs = req.query.maxTxs ? parseInt(req.query.maxTxs) : null;
    
    const uniqueSenders = new Set();
    let page = 1;
    const offset = 10000;
    let hasMore = true;
    let totalTxsProcessed = 0;
    
    while (hasMore) {
      try {
        if (maxTxs && totalTxsProcessed >= maxTxs) {
          hasMore = false;
          break;
        }
        
        const response = await axios.get(apiUrl, {
          params: {
            chainid: chainId,
            module: 'account',
            action: 'txlist',
            address: contractAddress,
            startblock: fromBlock,
            endblock: toBlock,
            page: page,
            offset: offset,
            sort: 'asc',
            apikey: apiKey
          }
        });
        
        if (response.data.status === '1' && response.data.result && Array.isArray(response.data.result)) {
          const transactions = response.data.result;
          
          for (const tx of transactions) {
            if (maxTxs && totalTxsProcessed >= maxTxs) {
              hasMore = false;
              break;
            }
            
            if (tx.to && tx.to.toLowerCase() === contractAddress.toLowerCase()) {
              if (tx.from && tx.from.toLowerCase() !== contractAddress.toLowerCase()) {
                uniqueSenders.add(tx.from);
              }
              totalTxsProcessed++;
            }
          }
          
          if (transactions.length === 0 || transactions.length < offset) {
            hasMore = false;
          } else if (!maxTxs || totalTxsProcessed < maxTxs) {
            page++;
          } else {
            hasMore = false;
          }
        } else {
          if (response.data.message) {
            if (response.data.message.includes('No transactions found') || 
                response.data.message === 'OK' && (!response.data.result || response.data.result.length === 0)) {
              hasMore = false;
            } else if (response.data.status === '0') {
              hasMore = false;
            }
          } else {
            hasMore = false;
          }
        }
        
        await new Promise(resolve => setTimeout(resolve, 200));
        
      } catch (error) {
        hasMore = false;
      }
    }
    
    const sendersList = Array.from(uniqueSenders);
    
    res.json({
      success: true,
      contractAddress: contractAddress,
      network: 'Arbitrum',
      fromBlock: fromBlock,
      toBlock: toBlock,
      maxTxs: maxTxs || 'unlimited',
      totalTxsProcessed: totalTxsProcessed,
      totalUniqueSenders: sendersList.length,
      senders: sendersList,
      pagesProcessed: page
    });
    
  } catch (error) {
    res.status(500).json({
      error: 'Error fetching contract message senders',
      details: error.message,
      stack: process.env.NODE_ENV !== 'production' ? error.stack : undefined
    });
  }
});


if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
  });
}

module.exports = app;