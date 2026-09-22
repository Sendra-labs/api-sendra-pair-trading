import axios, { AxiosResponse } from 'axios';
import { BinanceKline, ProcessedKline, BinanceApiResponse } from './types';

export class BinanceService {
  private readonly baseUrl: string;
  private readonly interval: string;
  private readonly limit: number;

  constructor(baseUrl: string, interval: string, limit: number) {
    this.baseUrl = baseUrl;
    this.interval = interval;
    this.limit = limit;
  }

  private coinFromSymbol(symbol: string): string {
    return symbol.toUpperCase().replace(/(USDT|USDC)$/, '');
  }

  /** Daily candles from Hyperliquid. Returns null when the coin has no book there. */
  private async getHyperliquidKlines(symbol: string): Promise<BinanceKline[] | null> {
    const coin = this.coinFromSymbol(symbol);
    const endTime = Date.now();
    const startTime = endTime - this.limit * 24 * 60 * 60 * 1000;
    const response: AxiosResponse<Array<{ t: number; T: number; o: string; h: string; l: string; c: string; v: string }>> = await axios.post(
      'https://api.hyperliquid.xyz/info',
      {
        type: 'candleSnapshot',
        req: { coin, interval: this.interval, startTime, endTime },
      },
      { timeout: 10000, headers: { 'Content-Type': 'application/json' } },
    );
    if (!Array.isArray(response.data) || response.data.length === 0) return null;
    return response.data.map((candle) => [
      candle.t,
      candle.o,
      candle.h,
      candle.l,
      candle.c,
      candle.v,
      candle.T,
      '0',
      0,
      '0',
      '0',
      '0',
    ]);
  }

  async getKlines(symbol: string): Promise<BinanceApiResponse> {
    try {
      const hyperliquid = await this.getHyperliquidKlines(symbol);
      if (hyperliquid) {
        return { success: true, data: hyperliquid, symbol };
      }
    } catch {
      // Coin is not on Hyperliquid; Binance remains the fallback.
    }

    try {
      const url = `${this.baseUrl}?symbol=${symbol}&interval=${this.interval}&limit=${this.limit}`;
      
      const response: AxiosResponse<BinanceKline[]> = await axios.get(url, {
        timeout: 10000,
        headers: {
          'User-Agent': 'Market-Neutral-Intelligence-Engine/1.0.0'
        }
      });

      if (response.status === 200 && Array.isArray(response.data)) {
        return {
          success: true,
          data: response.data,
          symbol: symbol
        };
      } else {
        return {
          success: false,
          error: `Invalid response for ${symbol}`,
          symbol: symbol
        };
      }
    } catch (error: any) {
      if (error.response) {
        const status = error.response.status;
        let errorMessage = `Error HTTP ${status}: ${error.response.data?.msg || error.message}`;
        
        if (status === 451) {
          errorMessage = `Error HTTP 451: Binance blocks access from this region. Please contact support if you believe this is an error.`;
        }
        
        return {
          success: false,
          error: errorMessage,
          symbol: symbol
        };
      } else if (error.request) {
        return {
          success: false,
          error: `Network error: ${error.message}`,
          symbol: symbol
        };
      } else {
        return {
          success: false,
          error: `Error: ${error.message}`,
          symbol: symbol
        };
      }
    }
  }

  async getMultipleKlines(symbols: string[]): Promise<Map<string, BinanceApiResponse>> {
    const promises = symbols.map(symbol => 
      this.getKlines(symbol).then(result => ({ symbol, result }))
    );

    const results = await Promise.allSettled(promises);
    const symbolData = new Map<string, BinanceApiResponse>();

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        symbolData.set(result.value.symbol, result.value.result);
      } else {
        symbolData.set(symbols[index], {
          success: false,
          error: `Error: ${result.reason}`,
          symbol: symbols[index]
        });
      }
    });

    return symbolData;
  }

  processKlines(rawKlines: BinanceKline[]): ProcessedKline[] {
    const processed = rawKlines.map((kline, index) => {
      const openTime = kline[0];
      const open = parseFloat(kline[1]);
      const high = parseFloat(kline[2]);
      const low = parseFloat(kline[3]);
      const close = parseFloat(kline[4]);
      const volume = parseFloat(kline[5]);
      
      if (isNaN(open) || isNaN(close) || isNaN(high) || isNaN(low) || isNaN(volume)) {
        return null;
      }
      
      const dailyChange = open > 0 ? ((close - open) / open) * 100 : 0;
      const dailyChangeAbs = close - open;

      return {
        timestamp: openTime,
        open,
        high,
        low,
        close,
        volume,
        dailyChange,
        dailyChangeAbs
      };
    }).filter(kline => kline !== null) as ProcessedKline[];
    
    return processed;
  }

  validateKlines(klines: ProcessedKline[]): boolean {
    if (!klines || klines.length === 0) {
      return false;
    }

    const validTimestamps = klines.every(kline => 
      kline.timestamp > 0 && 
      kline.open > 0 && 
      kline.close > 0 &&
      kline.high > 0 && 
      kline.low > 0 &&
      !isNaN(kline.open) &&
      !isNaN(kline.close) &&
      !isNaN(kline.high) &&
      !isNaN(kline.low) &&
      !isNaN(kline.dailyChange)
    );

    if (!validTimestamps) {
      return true;
    }

    const sortedTimestamps = klines.every((kline, index) => {
      if (index === 0) return true;
      return kline.timestamp >= klines[index - 1].timestamp;
    });

    if (!sortedTimestamps) {
      return true;
    }

    return true;
  }

  filterValidDays(klines: ProcessedKline[]): ProcessedKline[] {
    return klines.filter(kline => {
      const hasValidNumbers = !isNaN(kline.open) && 
                             !isNaN(kline.close) && 
                             !isNaN(kline.high) && 
                             !isNaN(kline.low) && 
                             !isNaN(kline.volume) &&
                             !isNaN(kline.dailyChange) &&
                             !isNaN(kline.dailyChangeAbs);
      
      if (!hasValidNumbers) {
        return false;
      }
      
      const extremeChange = Math.abs(kline.dailyChange) > 50;
      const lowVolume = kline.volume < 100;
      const validPriceRange = kline.high >= kline.low && 
                             kline.close >= kline.low && 
                             kline.close <= kline.high &&
                             kline.open >= kline.low && 
                             kline.open <= kline.high;
      
      return !extremeChange && !lowVolume && validPriceRange;
    });
  }

  synchronizeTimestamps(klinesA: ProcessedKline[], klinesB: ProcessedKline[]): {
    synchronizedA: ProcessedKline[];
    synchronizedB: ProcessedKline[];
  } {
    const timestampMapA = new Map<number, ProcessedKline>();
    const timestampMapB = new Map<number, ProcessedKline>();

    klinesA.forEach(kline => {
      timestampMapA.set(kline.timestamp, kline);
    });

    klinesB.forEach(kline => {
      timestampMapB.set(kline.timestamp, kline);
    });

    const commonTimestamps = Array.from(timestampMapA.keys())
      .filter(timestamp => timestampMapB.has(timestamp))
      .sort((a, b) => a - b);

    const synchronizedA: ProcessedKline[] = [];
    const synchronizedB: ProcessedKline[] = [];

    commonTimestamps.forEach(timestamp => {
      const klineA = timestampMapA.get(timestamp)!;
      const klineB = timestampMapB.get(timestamp)!;
      
      synchronizedA.push(klineA);
      synchronizedB.push(klineB);
    });

    return { synchronizedA, synchronizedB };
  }
}

