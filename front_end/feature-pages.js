const FEATURE_ASSET_META = {
  bitcoin: {
    name: 'Bitcoin',
    symbol: 'BTC-USD',
    market: 'Bitcoin',
    icon: '₿',
    color: '#ff5c5c'
  },
  nvidia: {
    name: 'NVIDIA',
    symbol: 'NVDA',
    market: 'NVIDIA',
    icon: 'N',
    color: '#ff6b6b'
  },
  gold: {
    name: 'Gold',
    symbol: 'GC=F',
    market: 'Gold',
    icon: 'Au',
    color: '#ff7a7a'
  }
};

function ensureAuthenticated() {
  const authenticated = localStorage.getItem('whatifAuthenticated') === 'true';
  if (!authenticated) {
    window.location.href = 'jarvis8.html';
    return false;
  }
  return true;
}

function getSelectedAssetKey() {
  const params = new URLSearchParams(window.location.search);
  const requestedAsset = params.get('asset');
  const storedAsset = localStorage.getItem('whatifSelectedAsset') || 'bitcoin';
  const assetKey = FEATURE_ASSET_META[requestedAsset] ? requestedAsset : FEATURE_ASSET_META[storedAsset] ? storedAsset : 'bitcoin';
  localStorage.setItem('whatifSelectedAsset', assetKey);
  return assetKey;
}

function getAssetMeta(assetKey) {
  return FEATURE_ASSET_META[assetKey] || FEATURE_ASSET_META.bitcoin;
}

function setSelectedAsset(assetKey) {
  localStorage.setItem('whatifSelectedAsset', assetKey);
}

function getDateRangeFromPeriod(days) {
  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setDate(endDate.getDate() - days);
  return {
    start: toInputDate(startDate),
    end: toInputDate(endDate)
  };
}

function toInputDate(date) {
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60000);
  return local.toISOString().slice(0, 10);
}

function buildFallbackSeries(assetKey, startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const totalDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86400000));
  const baseValues = {
    bitcoin: 42000,
    nvidia: 165,
    gold: 1980
  };
  const volatility = {
    bitcoin: 0.025,
    nvidia: 0.018,
    gold: 0.012
  };
  const drift = {
    bitcoin: 0.0018,
    nvidia: 0.0012,
    gold: 0.0009
  };
  const phase = { bitcoin: 0.7, nvidia: 1.4, gold: 2.2 };

  let currentValue = baseValues[assetKey] || 100;
  const series = [];

  for (let index = 0; index <= totalDays; index += 1) {
    const date = new Date(start.getTime() + index * 86400000);

    const cycle = Math.sin((index + phase[assetKey]) / 10) * currentValue * volatility[assetKey];
    const trend = currentValue * drift[assetKey];
    const noise = Math.sin((index + phase[assetKey] * 3.5) / 18) * currentValue * (volatility[assetKey] * 0.8);

    const open = Math.max(1, currentValue + cycle * 0.3);
    const close = Math.max(1, currentValue + cycle + trend + noise);
    const high = Math.max(open, close) * (1 + (volatility[assetKey] * 0.7));
    const low = Math.min(open, close) * (1 - (volatility[assetKey] * 0.7));

    currentValue = close;

    series.push({
      date,
      timestamp: Math.floor(date.getTime() / 1000),
      open: Number(open.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      close: Number(close.toFixed(2)),
      volume: 1000000 + index * 8500
    });
  }

  return series;
}

function parseAlphaVantageSeries(payload, assetKey) {
  const timeSeriesKey = Object.keys(payload || {}).find((key) => key.toLowerCase().includes('time series')) || null;
  if (!timeSeriesKey) return null;

  const entries = Object.entries(payload[timeSeriesKey] || {});
  return entries
    .map(([date, values]) => ({
      date: new Date(date),
      timestamp: Math.floor(new Date(date).getTime() / 1000),
      open: Number(values['1. open'] || values['1. Open'] || 0),
      high: Number(values['2. high'] || values['2. High'] || 0),
      low: Number(values['3. low'] || values['3. Low'] || 0),
      close: Number(values['4. close'] || values['4. Close'] || 0),
      volume: Number(values['5. volume'] || values['5. Volume'] || 0)
    }))
    .filter((point) => point.close > 0)
    .sort((a, b) => a.date - b.date);
}

async function fetchYahooSeries(assetKey, interval = '1d', startDate, endDate) {
  const meta = getAssetMeta(assetKey);

  try {
    const candidateUrls = [];

    if (assetKey === 'bitcoin') {
      candidateUrls.push(`https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=365&interval=daily`);
    }

    if (assetKey === 'nvidia') {
      candidateUrls.push(`https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=NVDA&apikey=demo`);
    }

    if (assetKey === 'gold') {
      candidateUrls.push(`https://www.alphavantage.co/query?function=FX_DAILY&from_symbol=XAU&to_symbol=USD&apikey=demo`);
    }

    for (const url of candidateUrls) {
      try {
        const response = await fetch(url, { headers: { 'Accept': 'application/json' } });
        if (!response.ok) continue;

        const payload = await response.json();

        if (assetKey === 'bitcoin' && payload && Array.isArray(payload.prices)) {
          const prices = payload.prices;
          const series = prices.map(([timestamp, price], index) => {
            const date = new Date(timestamp);
            const previous = prices[Math.max(0, index - 1)]?.[1] || price;
            const open = previous * (0.995 + (index % 7) * 0.0005);
            const high = Math.max(open, price) * (1 + 0.01 + (index % 5) * 0.001);
            const low = Math.min(open, price) * (1 - 0.01 - (index % 5) * 0.001);
            return {
              date,
              timestamp: Math.floor(date.getTime() / 1000),
              open: Number(open.toFixed(2)),
              high: Number(high.toFixed(2)),
              low: Number(low.toFixed(2)),
              close: Number(price.toFixed(2)),
              volume: 0
            };
          });
          if (series.length) return series.filter((point) => point.date >= new Date(startDate) && point.date <= new Date(endDate));
        }

        const parsed = parseAlphaVantageSeries(payload, assetKey);
        if (Array.isArray(parsed) && parsed.length) {
          return parsed.filter((point) => point.date >= new Date(startDate) && point.date <= new Date(endDate));
        }
      } catch (error) {
        console.warn(`Market feed failed for ${meta.name}:`, error);
      }
    }
  } catch (error) {
    console.warn(`Fetch attempt failed for ${meta.name}:`, error);
  }

  return buildFallbackSeries(assetKey, startDate, endDate);
}

function clampNumber(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function calculatePercentChange(current, previous) {
  if (!previous || previous === 0) return 0;
  return ((current - previous) / previous) * 100;
}

function calculateSMA(values, period) {
  return values.map((value, index) => {
    if (index < period - 1) return null;
    const slice = values.slice(index - period + 1, index + 1);
    const average = slice.reduce((sum, item) => sum + item, 0) / slice.length;
    return average;
  });
}

function calculateRSI(values, period = 14) {
  if (values.length <= period) {
    return values.map(() => 50);
  }

  const gains = [];
  const losses = [];

  for (let i = 1; i < values.length; i += 1) {
    const delta = values[i] - values[i - 1];
    gains.push(delta > 0 ? delta : 0);
    losses.push(delta < 0 ? Math.abs(delta) : 0);
  }

  let avgGain = gains.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((sum, value) => sum + value, 0) / period;

  const rsi = [50];

  for (let i = period; i < gains.length; i += 1) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;

    const relativeStrength = avgLoss === 0 ? 100 : avgGain / avgLoss;
    const value = 100 - (100 / (1 + relativeStrength));
    rsi.push(value);
  }

  return values.map((_, index) => {
    if (index === 0) return 50;
    if (index < period) return 50;
    return rsi[index - period] ?? 50;
  });
}

function calculateMACD(values, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  const ema = (period, data) => {
    const multiplier = 2 / (period + 1);
    let current = data[0];
    return data.map((value, index) => {
      if (index === 0) {
        current = value;
        return value;
      }
      current = (value - current) * multiplier + current;
      return current;
    });
  };

  const fastSeries = ema(fastPeriod, values);
  const slowSeries = ema(slowPeriod, values);
  const macdSeries = fastSeries.map((value, index) => value - slowSeries[index]);

  const signalSeries = ema(signalPeriod, macdSeries);

  return {
    macd: macdSeries,
    signal: signalSeries
  };
}

function calculateDrawdown(values) {
  let peak = values[0];
  let maxDrawdown = 0;

  for (const value of values) {
    if (value > peak) {
      peak = value;
    }
    const drawdown = (peak - value) / peak;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

  return maxDrawdown * 100;
}

function calculateVolatility(values) {
  if (values.length < 2) return 0;
  const returns = [];
  for (let i = 1; i < values.length; i += 1) {
    const previous = values[i - 1];
    const current = values[i];
    if (previous && previous !== 0) {
      returns.push((current - previous) / previous);
    }
  }

  if (!returns.length) return 0;
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1 || 1);
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

function formatMoney(value) {
  if (value === null || Number.isNaN(Number(value))) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2
  }).format(Number(value));
}

function formatPercent(value, digits = 2) {
  if (value === null || Number.isNaN(Number(value))) return '—';
  return `${Number(value).toFixed(digits)}%`;
}

function formatDate(value) {
  const date = new Date(value);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function getFallbackMarketNews(assetKey) {
  const items = {
    bitcoin: [
      { source: 'BTC Desk', title: 'Bitcoin traders continue watching macro-driven volatility and liquidity conditions.' },
      { source: 'Macro Lens', title: 'Digital asset flows remain sensitive to rate expectations and risk appetite.' },
      { source: 'Market Pulse', title: 'Analysts compare BTC behavior with broader equity volatility during uncertain cycles.' }
    ],
    nvidia: [
      { source: 'Chip Brief', title: 'Semiconductor demand remains tied to AI spending, data-center expansion and supply constraints.' },
      { source: 'Growth Signal', title: 'NVIDIA market attention stays focused on revenue momentum and gross margin trends.' },
      { source: 'Equity Radar', title: 'The stock often reacts to earnings guidance, GPU demand signals and broader software demand.' }
    ],
    gold: [
      { source: 'Commodity Wire', title: 'Gold prices often respond to real rates, inflation expectations and central bank policy signals.' },
      { source: 'Macro Outlook', title: 'Traders evaluate gold as a hedge when diversification and inflation concerns rise.' },
      { source: 'Portfolio Brief', title: 'Gold remains a common diversifier alongside equities and digital assets in tactical balancing.' }
    ]
  };

  return items[assetKey] || items.bitcoin;
}

async function fetchMarketNews(assetKey) {
  try {
    const response = await fetch(`/api/market/${assetKey}/news`, {
      credentials: 'same-origin'
    });

    if (!response.ok) {
      throw new Error('News service unavailable');
    }

    const payload = await response.json();
    const items = Array.isArray(payload?.items) ? payload.items : [];

    if (items.length) {
      return items;
    }
  } catch (error) {
    console.warn('Using fallback market news:', error);
  }

  return getFallbackMarketNews(assetKey);
}

function percentOf(value, total) {
  if (!total) return 0;
  return (value / total) * 100;
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values) {
  if (values.length < 2) return 0;
  const mean = average(values);
  const variance = values.reduce((sum, item) => sum + (item - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function buildPortfolioCovariance(assetSeries) {
  const names = Object.keys(assetSeries);
  const dailyReturns = {};

  names.forEach((key) => {
    const series = assetSeries[key];
    dailyReturns[key] = series.slice(1).map((point, index) => {
      const previous = series[index];
      if (!previous || previous.close === 0) return 0;
      return ((point.close - previous.close) / previous.close);
    });
  });

  const covarianceMatrix = {};
  names.forEach((rowKey) => {
    covarianceMatrix[rowKey] = {};
    names.forEach((columnKey) => {
      const rowValues = dailyReturns[rowKey];
      const columnValues = dailyReturns[columnKey];
      const minLen = Math.min(rowValues.length, columnValues.length);
      const values = Array.from({ length: minLen }, (_, index) => rowValues[index] * columnValues[index]);
      const meanRow = average(rowValues.slice(0, minLen));
      const meanColumn = average(columnValues.slice(0, minLen));
      const covariance = values.reduce((sum, value, index) => sum + (rowValues[index] - meanRow) * (columnValues[index] - meanColumn), 0) / (minLen - 1 || 1);
      covarianceMatrix[rowKey][columnKey] = covariance;
    });
  });

  return covarianceMatrix;
}

function calculatePortfolioMetrics(assetSeries, weights) {
  const assetNames = Object.keys(assetSeries);
  const totalWeight = Object.values(weights).reduce((sum, value) => sum + value, 0) || 1;
  const normalizedWeights = {};
  assetNames.forEach((key) => {
    normalizedWeights[key] = (weights[key] || 0) / totalWeight;
  });

  const covariance = buildPortfolioCovariance(assetSeries);
  let variance = 0;

  assetNames.forEach((rowKey) => {
    assetNames.forEach((columnKey) => {
      variance += normalizedWeights[rowKey] * normalizedWeights[columnKey] * covariance[rowKey][columnKey];
    });
  });

  const portfolioVolatility = Math.sqrt(variance) * Math.sqrt(252) * 100;
  const expectedReturn = assetNames.reduce((sum, key) => {
    const values = assetSeries[key].map((point) => ((point.close - point.open) / point.open));
    const meanReturn = average(values);
    return sum + normalizedWeights[key] * (meanReturn * 252 * 100);
  }, 0);

  return {
    portfolioVolatility,
    expectedReturn,
    weights: normalizedWeights
  };
}

function getCustomSafetyMessage() {
  return 'Historical simulations are educational and do not guarantee future performance. Use them as context, not certainty.';
}
